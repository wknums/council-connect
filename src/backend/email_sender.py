"""ACS Email sending helper for CouncilConnect.

Provides a synchronous convenience function `dispatch_campaign_emails` that:
  * Loads campaign + recipients from repository (already created)
  * Sends individual emails via Azure Communication Services Email
  * Updates CampaignRecipient status (sent/failed) and aggregates counters
  * Updates Campaign document with dispatchState & sentAt metadata

Designed for initial inline sending; can be refactored to queue-based async later.
"""
from __future__ import annotations

import os
import logging
from typing import Dict, Any, List
from datetime import datetime, timezone

from azure.communication.email import EmailClient
import re
from azure.core.exceptions import AzureError

try:  # local import fallback pattern
    from .cosmos.cosmos_repository import CosmosRepository
except ImportError:  # pragma: no cover
    from cosmos.cosmos_repository import CosmosRepository


ENABLE_EMAIL_SEND = (os.getenv("ENABLE_EMAIL_SEND", "false").lower() in {"1", "true", "yes"})
SENDER_ADDRESS = os.getenv("EMAIL_SENDER")
ACS_CONNECTION_STRING = os.getenv("ACS_CONNECTION_STRING")
ENABLE_SEND_DIAGNOSTICS = (os.getenv("ENABLE_SEND_DIAGNOSTICS", "false").lower() in {"1", "true", "yes"})

_email_client: EmailClient | None = None


def _client() -> EmailClient:
    global _email_client
    if _email_client is None:
        if not ACS_CONNECTION_STRING:
            raise RuntimeError("ACS_CONNECTION_STRING not configured")
        _email_client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)
    return _email_client


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    # Very small sanitizer to strip tags for plain text fallback
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    txt = re.sub(r"</p>", "\n\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<[^>]+>", "", txt)
    return re.sub(r"\n{3,}", "\n\n", txt).strip()


def dispatch_campaign_emails(councillor_id: str, campaign_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Send emails for a campaign.

    Side effects:
      * Updates CampaignRecipient status (sent|failed)
      * Updates Campaign document with dispatchState, sentAt, sentCount, failedCount
    Returns updated campaign document (not re-fetched; mutated copy)
    """
    repo = CosmosRepository()
    # Guard toggles
    if not ENABLE_EMAIL_SEND:
        logging.info("Email send disabled (ENABLE_EMAIL_SEND != true); skipping actual dispatch")
        # Mark campaign as simulated sent
        campaign_doc["dispatchState"] = "simulated"
        campaign_doc["sentAt"] = _utc_iso()
        campaign_doc.setdefault("pendingCount", campaign_doc.get("totalTargeted", 0))
        return campaign_doc
    if not SENDER_ADDRESS:
        raise RuntimeError("EMAIL_SENDER not configured")

    # Collect recipients (CampaignRecipient documents)
    recipients: List[Dict[str, Any]] = []
    for item in repo.list_campaigns(councillor_id):  # reuse list to get consistent container reference
        if item["id"] == campaign_doc["id"]:
            break  # found campaign (already have doc)
    # Query recipients directly (repository does not expose a specific method yet)
    container_key = "_single" if repo.is_dev else "SentEmails"
    container = repo.container_map[container_key]
    q = (
        "SELECT * FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp "
        "AND c.entityType='CampaignRecipient'"
    )
    recips_iter = container.query_items(q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_doc["id"]}], enable_cross_partition_query=True)
    recipients = list(recips_iter)

    sent_count = 0
    fail_count = 0
    client = _client()
    attachments = campaign_doc.get("_attachments_raw") or []
    for r in recipients:
        address = r.get("email")
        if not address:
            continue
        try:
            html_body = _personalize_html(campaign_doc, r)
            plain_text = _plain_text_fallback(campaign_doc.get("rawContent", ""), html_body)
            message_payload = {
                "senderAddress": SENDER_ADDRESS,
                "content": {
                    "subject": campaign_doc.get("subject", "No subject"),
                },
                "recipients": {
                    "to": [{"address": address}],
                },
                "userEngagementTrackingDisabled": False,  # Enable ACS built-in engagement tracking
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
            result = poller.result()  # Wait for completion
            message_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)
            delivery_status = None
            if message_id:
                try:
                    status_response = client.get_send_status(message_id)
                    delivery_status = getattr(status_response, "status", None) or getattr(status_response, "value", None)
                except AzureError as status_error:  # pragma: no cover - diagnostics path
                    logging.warning("[SEND][SYNC] status poll failed email=%s msg=%s err=%s", address, message_id, status_error)
            if message_id:
                r["messageId"] = message_id
            if delivery_status:
                r["deliveryStatus"] = delivery_status
            if ENABLE_SEND_DIAGNOSTICS:
                logging.info("[SEND][SYNC] OK email=%s campaign=%s messageId=%s deliveryStatus=%s", address, campaign_doc.get("id"), r.get("messageId"), r.get("deliveryStatus"))
            r["status"] = "sent"
            sent_count += 1
        except AzureError as e:  # pragma: no cover - network path
            logging.error("Send failed for %s: %s", address, e)
            r["status"] = "failed"
            if ENABLE_SEND_DIAGNOSTICS:
                r["error"] = str(e)
            fail_count += 1
        except Exception as e:  # pragma: no cover
            logging.exception("Unexpected send failure for %s: %s", address, e)
            r["status"] = "failed"
            if ENABLE_SEND_DIAGNOSTICS:
                r["error"] = str(e)
            fail_count += 1
        # Persist recipient status update
        repo._upsert(r, container_key="SentEmails" if not repo.is_dev else "_single")

    # Update campaign doc
    campaign_doc["dispatchState"] = "sent"
    campaign_doc["sentAt"] = _utc_iso()
    campaign_doc["sentCount"] = sent_count
    campaign_doc["failedCount"] = fail_count
    campaign_doc["pendingCount"] = max(len(recipients) - sent_count - fail_count, 0)
    repo._upsert(campaign_doc, container_key="SentEmails" if not repo.is_dev else "_single")
    return campaign_doc
