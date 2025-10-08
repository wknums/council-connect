import os
import asyncio
import logging
from azure.communication.email import EmailClient
from azure.communication.email import EmailContent, EmailMessage, EmailRecipients
from azure.identity import DefaultAzureCredential
from azure.cosmos import CosmosClient

# Environment variables
ACS_CONNECTION_STRING = os.getenv("ACS_CONNECTION_STRING")
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
COSMOS_DB_NAME = os.getenv("COSMOS_DB_NAME")
COSMOS_CONTAINER = os.getenv("COSMOS_ONE_CONTAINER_NAME")

# Initialize clients
email_client = EmailClient.from_connection_string(ACS_CONNECTION_STRING)
cosmos_client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)
database = cosmos_client.get_database_client(COSMOS_DB_NAME)
container = database.get_container_client(COSMOS_CONTAINER)

BATCH_SIZE = os.getenv("EMAIL_BATCH_SIZE", 50)
MAX_CONCURRENT = os.getenv("MAX_CONCURRENT", 10)

async def send_email_batch(batch, subject, body, sender):
    tasks = []
    for recipient in batch:
        message = EmailMessage(
            sender=sender,
            content=EmailContent(subject=subject, plain_text=body),
            recipients=EmailRecipients(to=[{"address": recipient["email"]}])
        )
        tasks.append(asyncio.create_task(send_email(message)))
    await asyncio.gather(*tasks)

async def send_email(message):
    try:
        response = email_client.send(message)
        logging.info(f"Email sent to {message.recipients.to[0]['address']} - Status: {response.status}")
    except Exception as e:
        logging.error(f"Failed to send email: {e}")

async def main(req):
    councillor_id = req.params.get("councillor_id")
    subject = req.params.get("subject")
    body = req.params.get("body")
    sender = os.getenv("EMAIL_SENDER")

    # Fetch recipients from Cosmos DB
    query = f"SELECT * FROM c WHERE c.councillorId = '{councillor_id}'"
    recipients = list(container.query_items(query=query, enable_cross_partition_query=True))

    # Batch and send emails
    for i in range(0, len(recipients), BATCH_SIZE):
        batch = recipients[i:i+BATCH_SIZE]
        await send_email_batch(batch, subject, body, sender)

    return {"status": "Emails queued successfully"}