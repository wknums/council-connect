"""Azure Functions app (Python) with HTTP triggered routes.

File renamed to `function_app.py` to align with Python v2 model startup
conventions (entry module discoverable by Functions host).
"""
from __future__ import annotations

import json
import os
import logging
import azure.functions as func

# Support both execution contexts:
# 1. Azure Functions host adds this directory to sys.path so absolute import works.
# 2. Pytest importing via 'src.backend.function_app' may not have 'cosmos' on sys.path.
try:  # pragma: no cover - simple import fallback logic
    from cosmos.cosmos_repository import CosmosRepository  # type: ignore
    try:  # sync sender
        from .email_sender import dispatch_campaign_emails  # type: ignore
    except (ModuleNotFoundError, ImportError) as err:  # pragma: no cover
        if not isinstance(err, ModuleNotFoundError) and "attempted relative import" not in str(err):
            raise
        try:
            from email_sender import dispatch_campaign_emails  # type: ignore
        except ModuleNotFoundError:
            dispatch_campaign_emails = None  # type: ignore
    try:  # async sender
        from .email_sender_async import dispatch_campaign_emails_async  # type: ignore
    except (ModuleNotFoundError, ImportError) as err:  # pragma: no cover
        if not isinstance(err, ModuleNotFoundError) and "attempted relative import" not in str(err):
            raise
        try:
            from email_sender_async import dispatch_campaign_emails_async  # type: ignore
        except ModuleNotFoundError:
            dispatch_campaign_emails_async = None  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    try:
        from .cosmos.cosmos_repository import CosmosRepository  # type: ignore
    except Exception as e:  # pragma: no cover
        raise e

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


def _json(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(body),
        mimetype="application/json",
        status_code=status,
    )


def _require_councillor(req: func.HttpRequest):
    cid = req.headers.get("x-councillor-id") or req.params.get("councillorId")
    if not cid:
        raise ValueError("Missing councillor identifier (x-councillor-id header)")
    return cid


OPENAPI_SPEC = {
    "openapi": "3.0.1",
    "info": {"title": "CouncilConnect API", "version": "0.1.0"},
    "paths": {
        "/distribution-lists": {"get": {"summary": "List distribution lists"}, "post": {"summary": "Create distribution list"}},
        "/distribution-lists/{listId}": {"delete": {"summary": "Delete distribution list"}},
        "/distribution-lists/{listId}/contacts": {"post": {"summary": "Add contact to list"}, "get": {"summary": "Contacts for list"}},
        "/contacts": {"get": {"summary": "List contacts"}},
        "/contacts/{contactId}": {"delete": {"summary": "Delete contact"}},
        "/campaigns": {"get": {"summary": "List campaigns"}, "post": {"summary": "Create campaign"}},
        "/campaigns/{campaignId}": {"delete": {"summary": "Delete campaign"}},
    "/campaigns/{campaignId}/metrics": {"get": {"summary": "Campaign metrics"}},
    "/campaigns/{campaignId}/recipients": {"get": {"summary": "Campaign recipients (debug)"}},
        "/track/open": {"post": {"summary": "Record open event"}},
    "/track/pixel": {"get": {"summary": "Email open tracking pixel"}},
        "/track/unsubscribe": {"post": {"summary": "Record unsubscribe event"}},
        "/openapi.json": {"get": {"summary": "OpenAPI spec"}},
        "/docs": {"get": {"summary": "Docs HTML"}},
    },
}


@app.route(route="openapi.json", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def openapi(req: func.HttpRequest) -> func.HttpResponse:  # pragma: no cover - thin wrapper
    return _json(OPENAPI_SPEC)


@app.route(route="docs", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def docs(req: func.HttpRequest) -> func.HttpResponse:  # pragma: no cover
    html = f"""
    <html><head><title>API Docs</title></head>
    <body style='font-family: system-ui; padding: 1rem;'>
      <h1>CouncilConnect API</h1>
      <p>OpenAPI spec: <a href='openapi.json'>openapi.json</a></p>
      <script>
        async function load(){{
          const res = await fetch('openapi.json');
            const spec = await res.json();
            document.getElementById('spec').textContent = JSON.stringify(spec, null, 2);
        }}
        load();
      </script>
      <pre id='spec' style='background:#f5f5f5; padding:1rem; overflow:auto;'></pre>
    </body></html>
    """
    return func.HttpResponse(body=html, mimetype="text/html", status_code=200)


@app.route(route="distribution-lists", methods=["GET", "POST"], auth_level=func.AuthLevel.ANONYMOUS)
def distribution_lists(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    if req.method == "GET":
        return _json({"items": repo.list_distribution_lists(cid)})
    # POST
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    name = (data.get("name") or "").strip()
    desc = (data.get("description") or "").strip()
    if not name:
        return _json({"error": "name required"}, 400)
    created = repo.create_distribution_list(cid, name, desc)
    return _json(created, 201)


@app.route(route="distribution-lists/{listId}", methods=["DELETE"], auth_level=func.AuthLevel.ANONYMOUS)
def delete_distribution_list(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    list_id = req.route_params.get("listId")
    if not list_id:
        return _json({"error": "listId missing"}, 400)
    ok = repo.delete_distribution_list(cid, list_id)
    if not ok:
        return _json({"error": "Not found"}, 404)
    return _json({"status": "deleted"}, 200)


@app.route(route="contacts", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def contacts(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    return _json({"items": repo.list_contacts(cid)})


@app.route(route="contacts/{contactId}", methods=["DELETE"], auth_level=func.AuthLevel.ANONYMOUS)
def delete_contact(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    contact_id = req.route_params.get("contactId")
    if not contact_id:
        return _json({"error": "contactId missing"}, 400)
    ok = repo.delete_contact(cid, contact_id)
    if not ok:
        return _json({"error": "Not found"}, 404)
    return _json({"status": "deleted"}, 200)


@app.route(route="distribution-lists/{listId}/contacts", methods=["POST", "GET"], auth_level=func.AuthLevel.ANONYMOUS)
def add_contact(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    list_id = req.route_params.get("listId")
    if not list_id:
        # When invoking the function directly in tests, azure.functions routing isn't parsing route params.
        # Fallback: extract listId from URL pattern /distribution-lists/{listId}/contacts
        path = req.url.split('/api/', 1)[-1]
        parts = path.strip('/').split('/')
        # Expected: ['distribution-lists', '{listId}', 'contacts']
        if len(parts) >= 3 and parts[0] == 'distribution-lists' and parts[2] == 'contacts':
            candidate = parts[1]
            # Basic sanity: UUID-like length or non-empty
            if candidate:
                list_id = candidate
    if req.method == "GET":
        return _json({"items": repo.contacts_for_list(cid, list_id)})
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    required = [data.get("email"), data.get("firstName"), data.get("lastName")]
    if not all(required):
        return _json({"error": "email, firstName, lastName required"}, 400)
    contact = repo.add_contact(cid, list_id, data["email"], data["firstName"], data["lastName"])
    return _json(contact, 201)


@app.route(route="campaigns_ori", methods=["GET", "POST"], auth_level=func.AuthLevel.ANONYMOUS)
async def campaigns_ori(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    if req.method == "GET":
        return _json({"items": repo.list_campaigns(cid)})
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    subject = (data.get("subject") or "").strip()
    content = data.get("content") or ""
    list_ids = data.get("listIds") or []
    attachments = data.get("attachments") or []  # [{ name, contentType, base64 }]
    if not (subject and content and list_ids):
        return _json({"error": "subject, content, listIds required"}, 400)
    campaign_doc = repo.create_campaign(cid, subject, content, list_ids)
    if attachments:
        # Store attachment metadata (do NOT leave large base64 in doc long-term)
        meta = []
        for a in attachments:
            if not (a.get("name") and a.get("contentType") and a.get("base64")):
                continue
            meta.append({
                "name": a["name"],
                "contentType": a["contentType"],
                "sizeBytes": len(a["base64"]) * 3 // 4  # approximate decoded size
            })
        campaign_doc["attachments"] = meta
        # Pass raw attachments to dispatch via transient field
        campaign_doc["_attachments_raw"] = attachments
    enable_inline = os.getenv("ENABLE_INLINE_SEND", "true").lower() in {"1", "true", "yes"}
    async_mode = os.getenv("ENABLE_ASYNC_SEND", "true").lower() in {"1", "true", "yes"}
    if enable_inline:
        try:
            if async_mode and dispatch_campaign_emails_async:
                campaign_doc = await dispatch_campaign_emails_async(cid, campaign_doc)
            elif dispatch_campaign_emails:  # fallback sync
                campaign_doc = dispatch_campaign_emails(cid, campaign_doc)
            else:
                campaign_doc["dispatchState"] = "queued"
        except Exception as e:  # pragma: no cover
            logging.error("Email dispatch failed: %s", e)
            campaign_doc["dispatchState"] = "error"
            campaign_doc["dispatchError"] = str(e)
    else:
        campaign_doc["dispatchState"] = "queued"
    # Remove transient raw attachments if present
    campaign_doc.pop("_attachments_raw", None)
    return _json(campaign_doc, 201)

@app.route(route="campaigns", methods=["GET", "POST"], auth_level=func.AuthLevel.ANONYMOUS)
async def campaigns(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    if req.method == "GET":
        return _json({"items": repo.list_campaigns(cid)})
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    subject = (data.get("subject") or "").strip()
    content = data.get("content") or ""
    list_ids = data.get("listIds") or []
    attachments = data.get("attachments") or []  # [{ name, contentType, base64 }]
    if not (subject and content and list_ids):
        return _json({"error": "subject, content, listIds required"}, 400)
    campaign_doc = repo.create_campaign(cid, subject, content, list_ids)
    if attachments:
        # Store attachment metadata (do NOT leave large base64 in doc long-term)
        meta = []
        for a in attachments:
            if not (a.get("name") and a.get("contentType") and a.get("base64")):
                continue
            meta.append({
                "name": a["name"],
                "contentType": a["contentType"],
                "sizeBytes": len(a["base64"]) * 3 // 4  # approximate decoded size
            })
        campaign_doc["attachments"] = meta
        # Pass raw attachments to dispatch via transient field
        campaign_doc["_attachments_raw"] = attachments
    enable_inline = os.getenv("ENABLE_INLINE_SEND", "true").lower() in {"1", "true", "yes"}
    logging.info("Email inline mode: %s", enable_inline)
    async_mode = os.getenv("ENABLE_ASYNC_SEND", "true").lower() in {"1", "true", "yes"}
    logging.info("Email async mode: %s", async_mode)
    if enable_inline:
        try:
            if async_mode: # and dispatch_campaign_emails_async:
                logging.info("Dispatching campaign emails async...")
                campaign_doc = await dispatch_campaign_emails_async(cid, campaign_doc)
            elif dispatch_campaign_emails:  # fallback sync
                logging.info("Dispatching campaign emails fallback: sync...")
                campaign_doc = dispatch_campaign_emails(cid, campaign_doc)
            else:
                logging.info("Queuing campaign emails ...")
                campaign_doc["dispatchState"] = "queued"
        except Exception as e:  # pragma: no cover
            logging.error("Email dispatch failed: %s", e)
            campaign_doc["dispatchState"] = "error"
            campaign_doc["dispatchError"] = str(e)
    else:
        logging.info("Queuing campaign emails as inline is false ...")
        campaign_doc["dispatchState"] = "queued"
    # Remove transient raw attachments if present
    campaign_doc.pop("_attachments_raw", None)
    return _json(campaign_doc, 201)

@app.route(route="campaigns/{campaignId}", methods=["DELETE"], auth_level=func.AuthLevel.ANONYMOUS)
def delete_campaign(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    campaign_id = req.route_params.get("campaignId")
    if not campaign_id:
        return _json({"error": "campaignId missing"}, 400)
    ok = repo.delete_campaign(cid, campaign_id)
    if not ok:
        return _json({"error": "Not found"}, 404)
    return _json({"status": "deleted"}, 200)


@app.route(route="campaigns/{campaignId}/metrics", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def campaign_metrics(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    campaign_id = req.route_params.get("campaignId") or req.params.get("campaignId")
    if not campaign_id:
        return _json({"error": "campaignId missing"}, 400)
    metrics = repo.campaign_metrics(cid, campaign_id)
    return _json(metrics)


@app.route(route="campaigns/{campaignId}/recipients", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def campaign_recipients(req: func.HttpRequest) -> func.HttpResponse:
    """Debug endpoint: list recipients + status for a campaign."""
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    campaign_id = req.route_params.get("campaignId") or req.params.get("campaignId")
    if not campaign_id:
        return _json({"error": "campaignId missing"}, 400)
    container_key = "_single" if repo.is_dev else "SentEmails"
    container = repo.container_map[container_key]
    # Include diagnostics fields if they exist; projection keeps payload small while showing messageId/error when recorded.
    q = ("SELECT c.id, c.email, c.status, c.messageId, c.error FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp "
        "AND c.entityType='CampaignRecipient'")
    items = list(container.query_items(q, parameters=[{"name": "@cid", "value": cid}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))
    total = len(items)
    sent = sum(1 for i in items if i.get("status") == "sent")
    failed = sum(1 for i in items if i.get("status") == "failed")
    pending = sum(1 for i in items if i.get("status") not in {"sent", "failed"})
    return _json({"items": items, "summary": {"total": total, "sent": sent, "failed": failed, "pending": pending}})


@app.route(route="track/open", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def track_open(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    if not (data.get("campaignId") and data.get("contactId")):
        return _json({"error": "campaignId & contactId required"}, 400)
    repo.record_tracking_event(cid, data["campaignId"], data["contactId"], "open", req.headers.get("user-agent"))
    return _json({"status": "ok"})


_PIXEL_BYTES = (
    b"GIF89a"  # Header
    b"\x01\x00\x01\x00"  # Logical Screen Width/Height = 1x1
    b"\x80"  # GCT follows, 1 bit per primary color
    b"\x00"  # Background color index
    b"\x00"  # Pixel aspect ratio
    b"\x00\x00\x00"  # Color #0: black
    b"\xff\xff\xff"  # Color #1: white
    b"\x21\xf9\x04\x01\x00\x00\x00\x00"  # Graphics Control Extension (no delay)
    b"\x2c\x00\x00\x00\x00\x01\x01\x00\x00"  # Image Descriptor
    b"\x02\x02\x44\x01\x00"  # Image data (LZW minimal)
    b"\x3b"  # Trailer
)


@app.route(route="track/pixel", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def track_pixel(req: func.HttpRequest) -> func.HttpResponse:
    """1x1 transparent-ish GIF tracking pixel.

    Expects query params: campaignId, contactId. Records an 'open' tracking event
    and returns a minimal GIF. Always 200 to avoid revealing tracking status.
    """
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError:
        # Fallback: attempt to infer from query if missing (less strict for pixel)
        cid = req.params.get("councillorId") or "unknown"
    campaign_id = req.params.get("campaignId")
    contact_id = req.params.get("contactId")
    if campaign_id and contact_id and cid != "unknown":
        try:
            repo.record_tracking_event(cid, campaign_id, contact_id, "open", req.headers.get("user-agent"))
        except Exception:  # noqa: BLE001
            pass  # Never raise to client for pixel
    return func.HttpResponse(body=_PIXEL_BYTES, mimetype="image/gif", status_code=200, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


@app.route(route="track/unsubscribe", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def track_unsubscribe(req: func.HttpRequest) -> func.HttpResponse:
    repo = CosmosRepository()
    try:
        cid = _require_councillor(req)
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    try:
        data = req.get_json()
    except Exception:  # noqa: BLE001
        return _json({"error": "Invalid JSON"}, 400)
    if not (data.get("campaignId") and data.get("contactId")):
        return _json({"error": "campaignId & contactId required"}, 400)
    repo.record_tracking_event(cid, data["campaignId"], data["contactId"], "unsubscribe", req.headers.get("user-agent"))
    return _json({"status": "ok"})
