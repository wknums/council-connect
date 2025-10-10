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
from typing import List, Dict, Any, Optional, Iterable

from azure.cosmos import CosmosClient, PartitionKey, exceptions

from .domain_models import (
    DistributionList, Contact, ListMembership, Campaign, CampaignRecipient,
    TrackingEvent, now_iso
)


DEV_ENV_VALUES = {"dev", "local", "development"}


_COSMOS_CLIENT_SINGLETON: CosmosClient | None = None


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
        total_targeted = len(unique_contact_ids)

        # Build processed HTML with tracking pixel + unsubscribe link placeholders.
        # Tracking pixel now uses the GET /api/track/pixel endpoint.
        # Placeholders: {campaignId} and {CONTACT_ID} replaced at send time.
        tracking_placeholder = "{CONTACT_ID}"
        base_html = raw_content
        if not base_html.strip().lower().startswith("<html"):
            base_html = f"<html><body>{base_html}</body></html>"
        pixel_tag = f"<img alt=\"\" style=\"display:none;width:1px;height:1px;\" src=\"/api/track/pixel?campaignId={ '{campaignId}' }&contactId={tracking_placeholder}\" />"
        unsubscribe_anchor = f"<p style=\"margin-top:16px;font-size:12px;color:#666;\">If you no longer wish to receive these emails <a href=\"/unsubscribe?campaignId={ '{campaignId}' }&contactId={tracking_placeholder}\">unsubscribe here</a>.</p>"
        processed_html = base_html.replace("</body>", f"{pixel_tag}{unsubscribe_anchor}</body>") if "</body>" in base_html else base_html + pixel_tag + unsubscribe_anchor

        campaign = Campaign(
            id=str(uuid.uuid4()),
            councillorId=councillor_id,
            subject=subject,
            rawContent=raw_content,
            status="queued",
            createdAt=now_iso(),
            totalTargeted=total_targeted,
        )
        campaign_item = campaign.to_item()
        campaign_item["processedContent"] = processed_html
        self._upsert(campaign_item, container_key="SentEmails" if not self.is_dev else "_single")

        recipients: List[CampaignRecipient] = []
        contacts_by_id = {c["id"]: c for c in self.list_contacts(councillor_id)}
        for cid in unique_contact_ids:
            c_doc = contacts_by_id.get(cid)
            if not c_doc:
                continue
            if c_doc.get("status") == "unsubscribed":
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

    def campaign_metrics(self, councillor_id: str, campaign_id: str) -> Dict[str, Any]:
        container_key = "_single" if self.is_dev else "EngagementAnalytics"
        c = self.container_map[container_key]
        query = (
            "SELECT c.eventType FROM c WHERE c.councillorId=@cid AND c.campaignId=@cmp "
            "AND c.entityType='TrackingEvent'"
        )
        events = list(c.query_items(query, parameters=[{"name": "@cid", "value": councillor_id}, {"name": "@cmp", "value": campaign_id}], enable_cross_partition_query=True))
        total_opens = sum(1 for e in events if e["eventType"] == "open")
        total_unsubs = sum(1 for e in events if e["eventType"] == "unsubscribe")
        # Fetch campaign for targeted count
        camp = None
        for item in self.list_campaigns(councillor_id):
            if item["id"] == campaign_id:
                camp = item
                break
        targeted = camp.get("totalTargeted", 0) if camp else 0
        return {
            "campaignId": campaign_id,
            "totalTargeted": targeted,
            "totalOpens": total_opens,
            "totalUnsubscribes": total_unsubs,
            "openRate": (total_opens / targeted * 100) if targeted else 0,
            "unsubscribeRate": (total_unsubs / targeted * 100) if targeted else 0,
        }

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
