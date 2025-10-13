"""Domain model definitions (Python) for backend Azure Functions.

These mirror the TypeScript types added for the frontend in `src/types/domain.ts`.
They are intentionally lightweight (no Pydantic dependency) to keep the
deployment surface minimal. Validation is defensive but shallow; callers should
perform any complex validation upstream if needed.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime


ISOTime = str  # Alias for readability


def now_iso() -> ISOTime:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


EntityType = Literal[
    "Councillor",
    "DistributionList",
    "Contact",
    "ListMembership",
    "Campaign",
    "CampaignRecipient",
    "TrackingEvent",
    "Unsubscribe"
]


@dataclass
class DistributionList:
    id: str
    councillorId: str
    name: str
    description: str
    createdAt: ISOTime
    entityType: EntityType = "DistributionList"

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Contact:
    id: str
    councillorId: str
    email: str
    firstName: str
    lastName: str
    addedAt: ISOTime
    status: str = "active"  # active|unsubscribed
    entityType: EntityType = "Contact"

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ListMembership:
    id: str
    councillorId: str
    listId: str
    contactId: str
    entityType: EntityType = "ListMembership"

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Campaign:
    id: str
    councillorId: str
    subject: str
    rawContent: str
    status: str  # draft|queued|sending|sent|failed
    createdAt: ISOTime
    sentAt: Optional[ISOTime] = None
    totalTargeted: Optional[int] = None
    totalFilteredUnsubscribed: Optional[int] = None
    entityType: EntityType = "Campaign"

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CampaignRecipient:
    id: str  # contactId or composite
    councillorId: str
    campaignId: str
    contactId: str
    email: str
    status: str  # pending|sent|failed
    entityType: EntityType = "CampaignRecipient"
    sentAt: Optional[ISOTime] = None
    deliveryStatus: Optional[str] = None
    messageId: Optional[str] = None
    deliveryError: Optional[str] = None

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TrackingEvent:
    id: str
    councillorId: str
    campaignId: str
    contactId: str
    eventType: str  # open|unsubscribe
    occurredAt: ISOTime
    userAgent: Optional[str] = None
    entityType: EntityType = "TrackingEvent"

    def to_item(self) -> Dict[str, Any]:
        return asdict(self)


def minimal_response(entity: Any) -> Dict[str, Any]:
    if hasattr(entity, "to_item"):
        return entity.to_item()
    if isinstance(entity, dict):
        return entity
    raise TypeError("Unsupported entity type for response")
