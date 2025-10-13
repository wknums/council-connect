"""Cosmos DB repository abstraction supporting dev (single container) and
prod (multi-container) modes.

Dev mode:
  - Uses a single container defined by COSMOS_ONE_CONTAINER_NAME
  - Stores all entity types with an `entityType` discriminator

Prod mode:
  - Uses multiple containers as provisioned by `cosmosdb_setup_prod.py`:
      Councillors, DistributionLists, OptOutLists, SentEmails, EngagementAnalytics
  - Some logical entity types are co-located to avoid additional containers:
      * Contact, DistributionList, ListMembership -> DistributionLists
      * Campaign, CampaignRecipient -> SentEmails
      * TrackingEvent -> EngagementAnalytics
      * Unsubscribes -> OptOutLists

The repository normalizes CRUD access patterns so higher layers remain agnostic.
"""
from __future__ import annotations

import os
import uuid
import hashlib
import time
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Any, Optional, Iterable, Set

from azure.cosmos import CosmosClient, PartitionKey, exceptions

from .domain_models import (
    DistributionList, Contact, ListMembership, Campaign, CampaignRecipient,
    TrackingEvent, now_iso
)


DEV_ENV_VALUES = {"dev", "local", "development"}

DEFAULT_TRACKING_BASE_URL = os.getenv("DEFAULT_TRACKING_BASE_URL", "http://localhost:7071")
DEFAULT_UNSUBSCRIBE_BASE_URL = os.getenv("DEFAULT_UNSUBSCRIBE_BASE_URL", "http://localhost:5173")

TRACKING_BASE_URL = os.getenv("TRACKING_BASE_URL") or os.getenv("PUBLIC_BASE_URL") or DEFAULT_TRACKING_BASE_URL
UNSUBSCRIBE_BASE_URL = os.getenv("UNSUBSCRIBE_BASE_URL") or os.getenv("PUBLIC_BASE_URL") or DEFAULT_UNSUBSCRIBE_BASE_URL
UNSUBSCRIBE_PATH = os.getenv("UNSUBSCRIBE_PATH", "/unsubscribe")


_COSMOS_CLIENT_SINGLETON: CosmosClient | None = None


def _build_public_url(base: Optional[str], path: str) -> str:
    if base:
        parsed = urlparse(base)
        if parsed.scheme and parsed.netloc:
            normalized = base if base.endswith("/") else base + "/"
            return urljoin(normalized, path.lstrip("/"))
    return path


def _get_client(endpoint: str, key: str) -> CosmosClient:
    global _COSMOS_CLIENT_SINGLETON
    if _COSMOS_CLIENT_SINGLETON is None:
        # Session consistency ensures read-your-writes when using same client instance
        _COSMOS_CLIENT_SINGLETON = CosmosClient(endpoint, credential=key, consistency_level="Session")
    return _COSMOS_CLIENT_SINGLETON


class CosmosRepository:
    def __init__(self):
        endpoint = os.getenv("COSMOS_ENDPOINT")
        key = os.getenv("COSMOS_KEY")
        db_name = os.getenv("COSMOS_DB_NAME")
        if not all([endpoint, key, db_name]):  # Simple guard
            raise RuntimeError("Missing required Cosmos DB environment variables")

        self.mode = os.getenv("APP_ENV", "dev").lower()
        self.client = _get_client(endpoint, key)
        self.database = self.client.get_database_client(db_name)

        if self.is_dev:
            single_container = os.getenv("COSMOS_ONE_CONTAINER_NAME")
            if not single_container:
                raise RuntimeError("COSMOS_ONE_CONTAINER_NAME required in dev mode")
            self.container_map = {"_single": self.database.get_container_client(single_container)}
        else:  # prod
            self.container_map = {
                "Councillors": self.database.get_container_client("Councillors"),
                "DistributionLists": self.database.get_container_client("DistributionLists"),
                "OptOutLists": self.database.get_container_client("OptOutLists"),
                "SentEmails": self.database.get_container_client("SentEmails"),
                "EngagementAnalytics": self.database.get_container_client("EngagementAnalytics"),
            }

    @property
    def is_dev(self) -> bool:
        return self.mode in DEV_ENV_VALUES

    # -------------------- Distribution Lists --------------------
    def list_distribution_lists(self, councillor_id: str) -> List[Dict[str, Any]]:
        if self.is_dev:
            c = self.container_map["_single"]
            query = "SELECT * FROM c WHERE c.councillorId=@cid AND c.entityType='DistributionList'"
            return list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}], enable_cross_partition_query=True))
        c = self.container_map["DistributionLists"]
        query = "SELECT * FROM c WHERE c.councillorId=@cid AND c.entityType='DistributionList'"
        return list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}], enable_cross_partition_query=True))

    def create_distribution_list(self, councillor_id: str, name: str, description: str) -> Dict[str, Any]:
        dl = DistributionList(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            name=name,
            description=description,
            createdAt=now_iso(),
        )
        item = dl.to_item()
        self._upsert(item, container_key="DistributionLists" if not self.is_dev else "_single")
        return item

    def delete_distribution_list(self, councillor_id: str, list_id: str) -> bool:
        """Delete a distribution list and its memberships. Contacts remain (non-destructive)."""
        container_key = "_single" if self.is_dev else "DistributionLists"
        c = self.container_map[container_key]
        # Fetch list to confirm existence
        query = "SELECT * FROM c WHERE c.councillorId=@cid AND c.id=@id AND c.entityType='DistributionList'"
        found = list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@id", "value": list_id}], enable_cross_partition_query=True))
        if not found:
            return False
        try:
            c.delete_item(list_id, partition_key=councillor_id)
        except exceptions.CosmosHttpResponseError:
            return False
        # Delete memberships referencing this list
        m_query = "SELECT c.id FROM c WHERE c.councillorId=@cid AND c.listId=@lid AND c.entityType='ListMembership'"
        memberships = list(c.query_items(m_query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@lid", "value": list_id}], enable_cross_partition_query=True))
        for m in memberships:
            try:
                c.delete_item(m['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
        return True

    # -------------------- Contacts & Membership -----------------
    def list_contacts(self, councillor_id: str) -> List[Dict[str, Any]]:
        container_key = "_single" if self.is_dev else "DistributionLists"
        c = self.container_map[container_key]
        query = "SELECT * FROM c WHERE c.councillorId=@cid AND c.entityType='Contact'"
        return list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}], enable_cross_partition_query=True))

    def add_contact(self, councillor_id: str, list_id: str, email: str, first_name: str, last_name: str) -> Dict[str, Any]:
        email_norm = email.strip().lower()
        contact = Contact(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            email=email_norm,
            firstName=first_name.strip(),
            lastName=last_name.strip(),
            addedAt=now_iso(),
        )
        membership = ListMembership(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            listId=list_id,
            contactId=contact.id,
        )
        container_key = "_single" if self.is_dev else "DistributionLists"
        self._upsert(contact.to_item(), container_key)
        self._upsert(membership.to_item(), container_key)
        return contact.to_item()

    def delete_contact(self, councillor_id: str, contact_id: str) -> bool:
        container_key = "_single" if self.is_dev else "DistributionLists"
        c = self.container_map[container_key]
        q = "SELECT * FROM c WHERE c.councillorId=@cid AND c.id=@id AND c.entityType='Contact'"
        found = list(c.query_items(q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@id", "value": contact_id}], enable_cross_partition_query=True))
        if not found:
            return False
        try:
            c.delete_item(contact_id, partition_key=councillor_id)
        except exceptions.CosmosHttpResponseError:
            return False
        # Delete memberships
        m_q = "SELECT c.id FROM c WHERE c.councillorId=@cid AND c.contactId=@cid2 AND c.entityType='ListMembership'"
        memberships = list(c.query_items(m_q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cid2", "value": contact_id}], enable_cross_partition_query=True))
        for m in memberships:
            try:
                c.delete_item(m['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
        # Delete campaign recipients referencing contact (SentEmails container in prod)
        sent_key = "_single" if self.is_dev else "SentEmails"
        sc = self.container_map[sent_key]
        r_q = "SELECT c.id FROM c WHERE c.councillorId=@cid AND c.contactId=@ct AND c.entityType='CampaignRecipient'"
        recips = list(sc.query_items(r_q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@ct", "value": contact_id}], enable_cross_partition_query=True))
        for r in recips:
            try:
                sc.delete_item(r['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
        return True

    def list_list_membership(self, councillor_id: str, list_id: str) -> List[str]:
        container_key = "_single" if self.is_dev else "DistributionLists"
        c = self.container_map[container_key]
        query = (
            "SELECT c.contactId FROM c WHERE c.councillorId=@cid AND c.listId=@lid "
            "AND c.entityType='ListMembership'"
        )
        rows = c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@lid", "value": list_id}], enable_cross_partition_query=True)
        return [r["contactId"] for r in rows]

    def contacts_for_list(self, councillor_id: str, list_id: str) -> List[Dict[str, Any]]:
        # Basic retry loop to mitigate eventual consistency when using a fresh client per request
        attempts = 3
        delay = 0.15
        for attempt in range(1, attempts + 1):
            contact_ids = set(self.list_list_membership(councillor_id, list_id))
            if contact_ids:
                contacts = self.list_contacts(councillor_id)
                return [c for c in contacts if c["id"] in contact_ids]
            if attempt < attempts:
                time.sleep(delay)
                delay *= 2
        return []

    # -------------------- Campaigns ------------------------------
    def create_campaign(self, councillor_id: str, subject: str, raw_content: str, target_list_ids: List[str]) -> Dict[str, Any]:
        # Aggregate all contacts from provided lists
        contact_ids: List[str] = []
        for lid in target_list_ids:
            contact_ids.extend(self.list_list_membership(councillor_id, lid))
        unique_contact_ids = list(dict.fromkeys(contact_ids))
        contacts_by_id = {c["id"]: c for c in self.list_contacts(councillor_id)}
        unsubscribed_ids = self._load_unsubscribed_contact_ids(councillor_id, contacts_by_id)

        total_filtered_unsub = sum(1 for cid in unique_contact_ids if cid in unsubscribed_ids)

        # Build processed HTML with tracking pixel + unsubscribe link placeholders.
        # Tracking pixel now uses the GET /api/track/pixel endpoint.
        # Placeholders: {campaignId} and {CONTACT_ID} replaced at send time.
        tracking_placeholder = "{CONTACT_ID}"
        campaign_placeholder = "{campaignId}"
        base_html = raw_content
        if not base_html.strip().lower().startswith("<html"):
            base_html = f"<html><body>{base_html}</body></html>"
        pixel_path = f"/api/track/pixel?councillorId={councillor_id}&campaignId={campaign_placeholder}&contactId={tracking_placeholder}"
        unsubscribe_path = f"{UNSUBSCRIBE_PATH}?councillorId={councillor_id}&campaignId={campaign_placeholder}&contactId={tracking_placeholder}"
        pixel_src = _build_public_url(TRACKING_BASE_URL, pixel_path)
        unsubscribe_href = _build_public_url(UNSUBSCRIBE_BASE_URL, unsubscribe_path)
        pixel_tag = f"<img alt=\"\" style=\"display:none;width:1px;height:1px;\" src=\"{pixel_src}\" />"
        unsubscribe_anchor = (
            "<p style=\"margin-top:16px;font-size:12px;color:#666;\">If you no longer wish to receive these emails "
            f"<a href=\"{unsubscribe_href}\">unsubscribe here</a>.</p>"
        )
        processed_html = base_html.replace("</body>", f"{pixel_tag}{unsubscribe_anchor}</body>") if "</body>" in base_html else base_html + pixel_tag + unsubscribe_anchor

        campaign = Campaign(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            subject=subject,
            rawContent=raw_content,
            status="queued",
            createdAt=now_iso(),
            totalTargeted=0,
            totalFilteredUnsubscribed=total_filtered_unsub,
        )
        campaign_item = campaign.to_item()
        campaign_item["processedContent"] = processed_html

        recipients: List[CampaignRecipient] = []
        for cid in unique_contact_ids:
            c_doc = contacts_by_id.get(cid)
            if not c_doc:
                continue
            if cid in unsubscribed_ids or c_doc.get("status") == "unsubscribed":
                continue
            recipients.append(
                CampaignRecipient(
                    id=str(uuid.uuid4()),
                    councillorId=councillor_id,
                    campaignId=campaign.id,
                    contactId=cid,
                    email=c_doc["email"],
                    status="pending",
                )
            )
        campaign_item["totalTargeted"] = len(recipients)
        campaign_item["pendingCount"] = len(recipients)
        campaign_item["sentCount"] = 0
        campaign_item["failedCount"] = 0
        self._upsert(campaign_item, container_key="SentEmails" if not self.is_dev else "_single")
        for r in recipients:
            self._upsert(r.to_item(), container_key="SentEmails" if not self.is_dev else "_single")
        return campaign_item

    def delete_campaign(self, councillor_id: str, campaign_id: str) -> bool:
        sent_key = "_single" if self.is_dev else "SentEmails"
        sk = self.container_map[sent_key]
        q = "SELECT * FROM c WHERE c.councillorId=@cid AND c.id=@id AND c.entityType='Campaign'"
        found = list(sk.query_items(q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@id", "value": campaign_id}], enable_cross_partition_query=True))
        if not found:
            return False
        try:
            sk.delete_item(campaign_id, partition_key=councillor_id)
        except exceptions.CosmosHttpResponseError:
            return False
        # Delete recipients
        r_q = "SELECT c.id FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp AND c.entityType='CampaignRecipient'"
        recips = list(sk.query_items(r_q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))
        for r in recips:
            try:
                sk.delete_item(r['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
        # Delete tracking events
        analytics_key = "_single" if self.is_dev else "EngagementAnalytics"
        ak = self.container_map[analytics_key]
        e_q = "SELECT c.id FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp AND c.entityType='TrackingEvent'"
        events = list(ak.query_items(e_q, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))
        for e in events:
            try:
                ak.delete_item(e['id'], partition_key=councillor_id)
            except exceptions.CosmosHttpResponseError:
                pass
        return True

    def list_campaigns(self, councillor_id: str) -> List[Dict[str, Any]]:
        container_key = "_single" if self.is_dev else "SentEmails"
        c = self.container_map[container_key]
        query = "SELECT * FROM c WHERE c.councillorId=@cid AND c.entityType='Campaign' ORDER BY c.createdAt DESC"
        return list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}], enable_cross_partition_query=True))

    # -------------------- Tracking & Analytics ------------------
    def record_tracking_event(self, councillor_id: str, campaign_id: str, contact_id: str, event_type: str, user_agent: Optional[str]) -> None:
        evt = TrackingEvent(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            campaignId=campaign_id,
            contactId=contact_id,
            eventType=event_type,
            occurredAt=now_iso(),
            userAgent=user_agent,
        )
        container_key = "_single" if self.is_dev else "EngagementAnalytics"
        self._upsert(evt.to_item(), container_key)
        if event_type == "unsubscribe":
            self._record_unsubscribe(councillor_id, campaign_id, contact_id)

    def campaign_metrics(self, councillor_id: str, campaign_id: str) -> Dict[str, Any]:
        analytics_key = "_single" if self.is_dev else "EngagementAnalytics"
        analytics_container = self.container_map[analytics_key]
        event_query = (
            "SELECT c.contactId, c.eventType FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp "
            "AND c.entityType='TrackingEvent'"
        )
        events = list(analytics_container.query_items(event_query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))
        total_opens = sum(1 for e in events if e["eventType"] == "open")
        unique_open_contacts = {e["contactId"] for e in events if e["eventType"] == "open" and e.get("contactId")}
        total_unsubs = sum(1 for e in events if e["eventType"] == "unsubscribe")
        unique_unsubs = {e["contactId"] for e in events if e["eventType"] == "unsubscribe" and e.get("contactId")}

        sent_key = "_single" if self.is_dev else "SentEmails"
        sent_container = self.container_map[sent_key]
        recipient_query = (
            "SELECT c.contactId, c.status, c.deliveryStatus FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp "
            "AND c.entityType='CampaignRecipient'"
        )
        recipients = list(sent_container.query_items(recipient_query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))

        total_targeted = len(recipients)
        total_sent = sum(1 for r in recipients if r.get("status") == "sent")
        total_failed = sum(1 for r in recipients if r.get("status") == "failed")
        total_pending = total_targeted - total_sent - total_failed
        delivery_status_counts: Dict[str, int] = {}
        for r in recipients:
            status = r.get("deliveryStatus")
            if status:
                delivery_status_counts[status] = delivery_status_counts.get(status, 0) + 1

        camp = next((item for item in self.list_campaigns(councillor_id) if item["id"] == campaign_id), None)
        filtered_unsub = camp.get("totalFilteredUnsubscribed", 0) if camp else 0

        rate_denominator = total_targeted or 1
        return {
            "campaignId": campaign_id,
            "totalTargeted": total_targeted,
            "totalSent": total_sent,
            "totalFailed": total_failed,
            "totalPending": total_pending,
            "totalFilteredUnsubscribed": filtered_unsub,
            "totalOpens": total_opens,
            "uniqueOpens": len(unique_open_contacts),
            "totalUnsubscribes": total_unsubs,
            "uniqueUnsubscribes": len(unique_unsubs),
            "openRate": (total_opens / rate_denominator * 100) if total_targeted else 0,
            "unsubscribeRate": (total_unsubs / rate_denominator * 100) if total_targeted else 0,
            "deliveryStatusBreakdown": delivery_status_counts,
        }

    def _load_unsubscribed_contact_ids(self, councillor_id: str, contacts_by_id: Dict[str, Dict[str, Any]]) -> Set[str]:
        unsubscribed: Set[str] = {cid for cid, c in contacts_by_id.items() if c.get("status") == "unsubscribed"}
        container_key = "_single" if self.is_dev else "OptOutLists"
        container = self.container_map.get(container_key)
        if container:
            query = (
                "SELECT c.contactId FROM c WHERE c.councillorId=@cid AND c.entityType='Unsubscribe'"
            )
            rows = container.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}], enable_cross_partition_query=True)
            for row in rows:
                cid = row.get("contactId")
                if cid:
                    unsubscribed.add(cid)
        return unsubscribed

    def _record_unsubscribe(self, councillor_id: str, campaign_id: str, contact_id: str) -> None:
        contacts = self.list_contacts(councillor_id)
        contact = next((c for c in contacts if c["id"] == contact_id), None)
        email = contact.get("email") if contact else None
        if not email:
            return
        self.add_unsubscribe_email(
            councillor_id,
            email,
            campaign_id=campaign_id,
            contact_id=contact_id,
            source="tracking",
        )

    # -------------------- Internal Helpers ----------------------
    def _upsert(self, item: Dict[str, Any], container_key: str):
        if self.is_dev:
            container = self.container_map["_single"]
        else:
            if container_key == "_single":  # safety fallback
                container = self.container_map["SentEmails"]
            else:
                # Map logical key to actual container (already prepared above)
                container = self.container_map.get(container_key, self.container_map["SentEmails"])
        container.upsert_item(item)

    # -------------------- Unsubscribe Management ----------------
    def list_unsubscribes(self, councillor_id: str) -> List[Dict[str, Any]]:
        container_key = "_single" if self.is_dev else "OptOutLists"
        container = self.container_map.get(container_key)
        if not container:
            return []
        query = (
            "SELECT c.id, c.email, c.displayEmail, c.contactId, c.campaignId, c.unsubscribedAt, c.source "
            "FROM c WHERE c.councillorId=@cid AND c.entityType='Unsubscribe'"
        )
        rows = list(
            container.query_items(
                query,
                parameters=[{"name": "@cid", "value": councillor_id}],
                enable_cross_partition_query=True,
            )
        )
        rows.sort(key=lambda r: r.get("unsubscribedAt", ""), reverse=True)
        return rows

    def add_unsubscribe_email(
        self,
        councillor_id: str,
        email: str,
        *,
        campaign_id: Optional[str] = None,
        contact_id: Optional[str] = None,
        source: str = "manual",
    ) -> Dict[str, Any]:
        email_clean = (email or "").strip().lower()
        if not email_clean:
            raise ValueError("email required")

        existing = next(
            (u for u in self.list_unsubscribes(councillor_id) if (u.get("email") or "").lower() == email_clean),
            None,
        )
        if existing:
            return existing

        contacts = self.list_contacts(councillor_id)
        contact = None
        if contact_id:
            contact = next((c for c in contacts if c["id"] == contact_id), None)
        if not contact:
            contact = next((c for c in contacts if (c.get("email") or "").lower() == email_clean), None)

        resolved_contact_id = contact["id"] if contact else contact_id
        if not resolved_contact_id:
            # Deterministic ID for email-only opt out to keep idempotency on repeats
            resolved_contact_id = f"email-{hashlib.sha1(email_clean.encode()).hexdigest()[:10]}"

        if contact and contact.get("status") != "unsubscribed":
            contact["status"] = "unsubscribed"
            self._upsert(contact, container_key="DistributionLists" if not self.is_dev else "_single")

        opt_item = {
            "id": f"unsubscribe-{resolved_contact_id}",
            "councillorId": councillor_id,
            "campaignId": campaign_id,
            "contactId": resolved_contact_id,
            "email": email_clean,
            "displayEmail": (email or "").strip() or email_clean,
            "entityType": "Unsubscribe",
            "unsubscribedAt": now_iso(),
            "source": source,
        }
        container_key = "_single" if self.is_dev else "OptOutLists"
        self._upsert(opt_item, container_key)
        return opt_item

    def remove_unsubscribe(self, councillor_id: str, unsubscribe_id: str) -> bool:
        container_key = "_single" if self.is_dev else "OptOutLists"
        container = self.container_map.get(container_key)
        if not container:
            return False
        try:
            item = container.read_item(unsubscribe_id, partition_key=councillor_id)
        except exceptions.CosmosResourceNotFoundError:
            return False
        except exceptions.CosmosHttpResponseError:  # pragma: no cover - rare runtime issue
            return False
        try:
            container.delete_item(unsubscribe_id, partition_key=councillor_id)
        except exceptions.CosmosHttpResponseError:
            return False

        contact_id = item.get("contactId")
        if contact_id:
            contacts = self.list_contacts(councillor_id)
            contact = next((c for c in contacts if c["id"] == contact_id), None)
            if contact and contact.get("status") == "unsubscribed":
                contact["status"] = "active"
                self._upsert(contact, container_key="DistributionLists" if not self.is_dev else "_single")
        return True

    def remove_unsubscribe_by_email(self, councillor_id: str, email: str) -> bool:
        email_clean = (email or "").strip().lower()
        if not email_clean:
            return False
        target = next(
            (u for u in self.list_unsubscribes(councillor_id) if (u.get("email") or "").lower() == email_clean),
            None,
        )
        if not target:
            return False
        return self.remove_unsubscribe(councillor_id, target["id"])
