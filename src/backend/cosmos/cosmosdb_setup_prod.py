from azure.cosmos import CosmosClient, PartitionKey, exceptions
import os
import dotenv

dotenv.load_dotenv()

"""Production Cosmos DB setup script.

Creates required containers (serverless friendly) with:
 - Environment variable validation
 - Idempotent creation (logs existing vs created)
 - Basic indexing policy applied at creation time
 - Per-container health check (upsert/read/delete test doc)
"""

# Environment variables (shared with dev script naming for consistency)
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
DATABASE_NAME = os.getenv("COSMOS_DB_NAME")

def fail(msg: str):
  raise SystemExit(f"[cosmos-setup:prod:error] {msg}")

required_env = {
  'COSMOS_ENDPOINT': COSMOS_ENDPOINT,
  'COSMOS_KEY': COSMOS_KEY,
  'COSMOS_DB_NAME': DATABASE_NAME,
}
missing = [k for k,v in required_env.items() if not v]
if missing:
  fail(f"Missing required environment variables: {', '.join(missing)}")

print("[cosmos-setup:prod] Environment variables validated")

client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)
database = client.create_database_if_not_exists(id=DATABASE_NAME)
print(f"[cosmos-setup:prod] Database '{DATABASE_NAME}' ready")

## Sample document templates (removed from active execution to keep setup script focused).
# If you need seed data, reintroduce these with Python True/False and an explicit upsert phase.
# councilor_profile = { ... }


indexing_policy = {
  "indexingMode": "consistent",
  "automatic": True,
  "includedPaths": [
    {"path": "/*"}
  ],
  "excludedPaths": [
    {"path": "/recipients/*"}
  ]
}

containers = [
  {"id": "Councillors", "partition_key": PartitionKey(path="/councillorId")},
  {"id": "DistributionLists", "partition_key": PartitionKey(path="/councillorId")},
  {"id": "OptOutLists", "partition_key": PartitionKey(path="/councillorId")},
  {"id": "SentEmails", "partition_key": PartitionKey(path="/councillorId")},
  {"id": "EngagementAnalytics", "partition_key": PartitionKey(path="/councillorId")},
]

def ensure_container(id: str, pk: PartitionKey):
  existed = True
  try:
    c = database.get_container_client(id)
    c.read()
    print(f"[cosmos-setup:prod] Container '{id}' exists")
  except exceptions.CosmosResourceNotFoundError:
    existed = False
    print(f"[cosmos-setup:prod] Creating container '{id}'")
    c = database.create_container_if_not_exists(
      id=id,
      partition_key=pk,
      indexing_policy=indexing_policy
    )
  return c, existed

def health_check(container):
  test_id = "_healthcheck"
  doc = {"id": test_id, "councillorId": "healthcheck", "scope": container.id, "status": "ok"}
  try:
    container.upsert_item(doc)
    fetched = container.read_item(item=test_id, partition_key="healthcheck")
    if fetched.get("status") == "ok":
      print(f"[cosmos-setup:prod] Health check ok for '{container.id}'")
    else:
      print(f"[cosmos-setup:prod:warn] Unexpected healthcheck content for '{container.id}'")
    try:
      container.delete_item(item=test_id, partition_key="healthcheck")
    except Exception:  # noqa: BLE001
      print(f"[cosmos-setup:prod:warn] Cleanup failed for '{container.id}' test item")
  except Exception as e:  # noqa: BLE001
    print(f"[cosmos-setup:prod:error] Health check failed for '{container.id}': {e}")
    raise

for meta in containers:
  container, existed = ensure_container(meta["id"], meta["partition_key"])
  health_check(container)

print("[cosmos-setup:prod] All containers ready")