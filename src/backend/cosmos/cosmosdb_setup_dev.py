from azure.cosmos import CosmosClient, PartitionKey, exceptions
import os
import dotenv

dotenv.load_dotenv()

# Environment variables
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
DATABASE_NAME = os.getenv("COSMOS_DB_NAME")
CONTAINER_NAME = os.getenv("COSMOS_ONE_CONTAINER_NAME")

# Initialize Cosmos client
client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)

# Create database if not exists
database = client.create_database_if_not_exists(id=DATABASE_NAME)

def fail(msg: str):
    raise SystemExit(f"[cosmos-setup:error] {msg}")

required_env = {
    'COSMOS_ENDPOINT': COSMOS_ENDPOINT,
    'COSMOS_KEY': COSMOS_KEY,
    'COSMOS_DB_NAME': DATABASE_NAME,
    'COSMOS_ONE_CONTAINER_NAME': CONTAINER_NAME,
}
missing = [k for k, v in required_env.items() if not v]
if missing:
    fail(f"Missing required environment variables: {', '.join(missing)}")

print("[cosmos-setup] Environment variables validated")

# For a serverless Cosmos DB account, manual throughput (offer_throughput) and replace_throughput are NOT allowed.
# Optional indexing policy (applied on first creation only). If the container already exists, Cosmos ignores these settings.
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

# Detect existing container
container_existed = True
try:
    container = database.get_container_client(CONTAINER_NAME)
    container.read()
    print(f"[cosmos-setup] Container '{CONTAINER_NAME}' already exists")
except exceptions.CosmosResourceNotFoundError:
    container_existed = False
    print(f"[cosmos-setup] Container '{CONTAINER_NAME}' not found. Creating...")
    container = database.create_container_if_not_exists(
        id=CONTAINER_NAME,
        partition_key=PartitionKey(path="/councillorId"),
        indexing_policy=indexing_policy
    )

action = "confirmed" if container_existed else "created"
print(f"[cosmos-setup] Container '{CONTAINER_NAME}' {action} with partition key '/councillorId' (serverless mode)")

# Health check: upsert + read + delete a test item
test_id = "_healthcheck"
test_doc = {"id": test_id, "councillorId": "healthcheck", "_ts": None, "status": "ok"}
try:
    container.upsert_item(test_doc)
    fetched = container.read_item(item=test_id, partition_key="healthcheck")
    if fetched.get("status") == "ok":
        print("[cosmos-setup] Health check item upsert/read successful")
    else:
        print("[cosmos-setup:warn] Health check item read but unexpected content")
    # Cleanup (ignore errors)
    try:
        container.delete_item(item=test_id, partition_key="healthcheck")
        print("[cosmos-setup] Health check item cleaned up")
    except Exception as cleanup_err:  # noqa: BLE001
        print(f"[cosmos-setup:warn] Failed to delete health check item: {cleanup_err}")
except Exception as hc_err:  # noqa: BLE001
    print(f"[cosmos-setup:error] Health check failed: {hc_err}")
    fail("Cosmos DB health check failed. Investigate connection and permissions.")

print("[cosmos-setup] Completed successfully")
