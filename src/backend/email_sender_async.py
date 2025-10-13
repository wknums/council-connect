"""Asynchronous ACS email dispatcher.

Uses asyncio + batching + limited concurrency to send campaign emails.
Falls back gracefully if ACS env vars incomplete.
"""
from __future__ import annotations

import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Tuple

try:
    from azure.communication.email import EmailClient
    from azure.core.exceptions import AzureError
except ImportError as exc:  # pragma: no cover - fail fast when SDK missing
    raise ImportError(
        "Azure Communication Services Email SDK is required. Install dependencies with "
        "'pip install azure-communication-email azure-core'."
    ) from exc


try:
    from .cosmos.cosmos_repository import CosmosRepository
except ImportError:  # pragma: no cover
    from cosmos.cosmos_repository import CosmosRepository

ENABLE_EMAIL_SEND = (os.getenv("ENABLE_EMAIL_SEND", "false").lower() in {"1", "true", "yes"})
SENDER_ADDRESS = os.getenv("EMAIL_SENDER")
ACS_CONNECTION_STRING = os.getenv("ACS_CONNECTION_STRING")
BATCH_SIZE = int(os.getenv("EMAIL_BATCH_SIZE", "50"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "10"))
ENABLE_SEND_DIAGNOSTICS = (os.getenv("ENABLE_SEND_DIAGNOSTICS", "false").lower() in {"1", "true", "yes"})

_client: EmailClient | None = None


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_client() -> EmailClient:
    global _client
    if _client is None:
        if not ACS_CONNECTION_STRING:
            raise RuntimeError("ACS_CONNECTION_STRING not configured")
        _client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)
    return _client


def _personalize_html(campaign_doc: Dict[str, Any], recipient: Dict[str, Any]) -> str | None:
    template = campaign_doc.get("processedContent")
    if not template:
        return None
    html = template.replace("{campaignId}", campaign_doc.get("id", ""))
    contact_id = recipient.get("contactId") or recipient.get("id", "")
    html = html.replace("{CONTACT_ID}", contact_id)
    return html


def _plain_text_fallback(raw: str, html: str | None) -> str:
    if raw:
        return raw
    if not html:
        return ""
    import re
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    txt = re.sub(r"</p>", "\n\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<[^>]+>", "", txt)
    return re.sub(r"\n{3,}", "\n\n", txt).strip()


async def _send_one(recipient: Dict[str, Any], subject: str, raw_body: str, campaign_doc: Dict[str, Any], attachments: List[Dict[str, str]]) -> Tuple[str, bool, str | None, str | None, str | None]:
    email_addr = recipient.get("email")
    if not email_addr:
        return ("", False, None, "missing-address")
    client = _get_client()
    html_body = _personalize_html(campaign_doc, recipient)
    plain_text = _plain_text_fallback(raw_body, html_body)
    try:
        message_payload: Dict[str, Any] = {
            "senderAddress": SENDER_ADDRESS,
            "content": {
                "subject": subject,
            },
            "recipients": {
                "to": [{"address": email_addr}],
            },
        }
        if html_body:
            message_payload["content"]["html"] = html_body
        if plain_text:
            message_payload["content"]["plainText"] = plain_text
        valid_attachments = [
            {
                "name": a["name"],
                "contentType": a["contentType"],
                "contentInBase64": a["base64"],
            }
            for a in attachments
            if a.get("name") and a.get("contentType") and a.get("base64")
        ]
        if valid_attachments:
            message_payload["attachments"] = valid_attachments
        poller = client.begin_send(message_payload)
        result = poller.result()
        message_id = result.get("id") if isinstance(result, dict) else getattr(result, 'id', None)
        delivery_status: str | None = None
        if message_id:
            try:
                status_response = client.get_send_status(message_id)
                delivery_status = getattr(status_response, "status", None) or getattr(status_response, "value", None)
            except AzureError as status_error:  # pragma: no cover - diagnostics only
                logging.warning("[SEND][ASYNC] status poll failed email=%s msg=%s err=%s", email_addr, message_id, status_error)
        if ENABLE_SEND_DIAGNOSTICS:
            logging.info("[SEND][ASYNC] OK email=%s campaign=%s messageId=%s deliveryStatus=%s", email_addr, campaign_doc.get("id"), message_id, delivery_status)
        return (email_addr, True, message_id, delivery_status, None)
    except AzureError as e:  # pragma: no cover
        logging.error("Send failed for %s: %s", email_addr, e)
        return (email_addr, False, None, None, str(e))
    except Exception as e:  # pragma: no cover
        logging.exception("Unexpected failure for %s: %s", email_addr, e)
        return (email_addr, False, None, None, str(e))


async def _process_batch(batch: List[Dict[str, Any]], subject: str, body: str, sem: asyncio.Semaphore, campaign_doc: Dict[str, Any], attachments: List[Dict[str, str]]):
    async with sem:
        results = await asyncio.gather(*[_send_one(r, subject, body, campaign_doc, attachments) for r in batch])
        return results


async def dispatch_campaign_emails_async(councillor_id: str, campaign_doc: Dict[str, Any]) -> Dict[str, Any]:
    repo = CosmosRepository()
    if not ENABLE_EMAIL_SEND:
        campaign_doc["dispatchState"] = "simulated"
        campaign_doc["sentAt"] = _utc_iso()
        campaign_doc.setdefault("pendingCount", campaign_doc.get("totalTargeted", 0))
        repo._upsert(campaign_doc, container_key="SentEmails" if not repo.is_dev else "_single")
        return campaign_doc
    if not SENDER_ADDRESS:
        raise RuntimeError("EMAIL_SENDER not configured")

    # Load recipients
    container_key = "_single" if repo.is_dev else "SentEmails"
    container = repo.container_map[container_key]
    q = (
        "SELECT * FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp AND c.entityType='CampaignRecipient'"
    )
    items = list(container.query_items(q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_doc["id"]}], enable_cross_partition_query=True))
    subject = campaign_doc.get("subject", "No subject")
    # Use rawContent for plain text for now; processedContent is stored for potential HTML usage.
    raw_body = campaign_doc.get("rawContent", "")

    sem = asyncio.Semaphore(MAX_CONCURRENT)
    attachments = campaign_doc.get("_attachments_raw") or []
    tasks = []
    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        tasks.append(asyncio.create_task(_process_batch(batch, subject, raw_body, sem, campaign_doc, attachments)))

    sent = 0
    failed = 0
    all_results: List[Tuple[str, bool, str | None, str | None, str | None]] = []
    gathered = await asyncio.gather(*tasks)
    for group in gathered:
        for addr, ok, message_id, err in group:
            all_results.append((addr, ok, message_id, err))
            if ok:
                sent += 1
            else:
                failed += 1

    # Build address -> success map
    status_map = {addr: (ok, mid, status, err) for addr, ok, mid, status, err in all_results if addr}
    for r in items:
        addr = r.get("email")
        if addr in status_map:
            ok, mid, delivery_status, err = status_map[addr]
            r["status"] = "sent" if ok else "failed"
            if mid:
                r["messageId"] = mid
            if delivery_status:
                r["deliveryStatus"] = delivery_status
            if err:
                r["error"] = err
            if ENABLE_SEND_DIAGNOSTICS:
                logging.log(logging.INFO if ok else logging.ERROR, "[SEND][ASYNC] %s email=%s campaign=%s messageId=%s deliveryStatus=%s error=%s", "OK" if ok else "FAIL", addr, campaign_doc.get("id"), mid, delivery_status, err)
        else:
            r["status"] = "failed"
        repo._upsert(r, container_key="SentEmails" if not repo.is_dev else "_single")

    campaign_doc["dispatchState"] = "sent"
    campaign_doc["sentAt"] = _utc_iso()
    campaign_doc["sentCount"] = sent
    campaign_doc["failedCount"] = failed
    campaign_doc["pendingCount"] = max(len(items) - sent - failed, 0)
    repo._upsert(campaign_doc, container_key="SentEmails" if not repo.is_dev else "_single")
    return campaign_doc
