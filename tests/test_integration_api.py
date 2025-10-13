import asyncio
import json
import azure.functions as func
import pytest

from src.backend import function_app  # type: ignore


def _req(
    method: str,
    path: str,
    councillor_id: str,
    body: dict | None = None,
    route_params: dict | None = None,
    query: dict | None = None,
):
    data = json.dumps(body).encode() if body else None
    return func.HttpRequest(
        method=method,
        url=f"http://localhost/api/{path.lstrip('/')}",
        headers={'x-councillor-id': councillor_id},
        params=query or {},
        route_params=route_params or {},
        body=data or b''
    )


def _resolve(result):
    if asyncio.iscoroutine(result):
        return asyncio.run(result)
    return result


def test_openapi(councillor_id):
    resp = function_app.openapi(_req('GET', '/openapi.json', councillor_id))
    assert resp.status_code == 200
    spec = json.loads(resp.get_body())
    assert spec['info']['title'] == 'CouncilConnect API'
    assert '/campaigns' in spec['paths']


def test_distribution_list_lifecycle(councillor_id):
    # Empty list
    empty_resp = function_app.distribution_lists(_req('GET', '/distribution-lists', councillor_id))
    assert json.loads(empty_resp.get_body())['items'] == []
    # Create
    create_resp = function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "Residents", "description": "Ward"}))
    assert create_resp.status_code == 201
    # List again
    list_resp = function_app.distribution_lists(_req('GET', '/distribution-lists', councillor_id))
    items = json.loads(list_resp.get_body())['items']
    assert len(items) == 1 and items[0]['name'] == 'Residents'


def test_contact_add_and_list(councillor_id):
    # Need a list first
    create_list = function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "ListA", "description": "desc"}))
    assert create_list.status_code == 201
    list_id = json.loads(create_list.get_body())['id']
    add_contact = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "person@example.com", "firstName": "Ada", "lastName": "Lovelace"}))
    assert add_contact.status_code == 201
    contacts = json.loads(function_app.contacts(_req('GET', '/contacts', councillor_id)).get_body())['items']
    assert any(c['email'] == 'person@example.com' for c in contacts)
    # List-specific contacts
    list_contacts_resp = function_app.add_contact(_req('GET', f'/distribution-lists/{list_id}/contacts', councillor_id, route_params={'listId': list_id}))
    list_contacts = json.loads(list_contacts_resp.get_body())['items']
    assert len(list_contacts) == 1 and list_contacts[0]['email'] == 'person@example.com'


def test_campaign_creation_and_metrics(councillor_id):
    # Setup list + contact
    list_resp = function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "ListB", "description": "desc"}))
    list_id = json.loads(list_resp.get_body())['id']
    add_contact = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "c@example.com", "firstName": "C", "lastName": "User"}))
    assert add_contact.status_code == 201
    # Create campaign
    camp_resp = _resolve(function_app.campaigns(_req('POST', '/campaigns', councillor_id, {"subject": "Update", "content": "Hello", "listIds": [list_id]})))
    assert camp_resp.status_code == 201
    camp_id = json.loads(camp_resp.get_body())['id']
    # List campaigns
    list_camps = json.loads(_resolve(function_app.campaigns(_req('GET', '/campaigns', councillor_id))).get_body())['items']
    assert any(c['id'] == camp_id for c in list_camps)
    # Metrics (no events yet)
    metrics = json.loads(function_app.campaign_metrics(_req('GET', f'/campaigns/{camp_id}/metrics', councillor_id, route_params={'campaignId': camp_id})).get_body())
    assert metrics['campaignId'] == camp_id
    assert metrics['totalTargeted'] == 1
    assert metrics['totalSent'] == 0
    assert metrics['totalPending'] == 1
    assert metrics['totalOpens'] == 0
    assert metrics['uniqueOpens'] == 0
    assert metrics['totalUnsubscribes'] == 0
    assert metrics['uniqueUnsubscribes'] == 0


def test_tracking_events_affect_metrics(councillor_id):
    # Setup list/contact/campaign
    list_id = json.loads(function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "ListC", "description": "d"})).get_body())['id']
    contact_resp = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "track@example.com", "firstName": "T", "lastName": "E"}))
    contact_id = json.loads(contact_resp.get_body())['id']
    camp_id = json.loads(_resolve(function_app.campaigns(_req('POST', '/campaigns', councillor_id, {"subject": "Notice", "content": "Body", "listIds": [list_id]}))).get_body())['id']
    # Record open & unsubscribe
    o = function_app.track_open(_req('POST', '/track/open', councillor_id, {"campaignId": camp_id, "contactId": contact_id}))
    u = function_app.track_unsubscribe(_req('POST', '/track/unsubscribe', councillor_id, {"campaignId": camp_id, "contactId": contact_id}))
    assert o.status_code == 200 and u.status_code == 200
    metrics = json.loads(function_app.campaign_metrics(_req('GET', f'/campaigns/{camp_id}/metrics', councillor_id, route_params={'campaignId': camp_id})).get_body())
    assert metrics['totalOpens'] == 1
    assert metrics['totalUnsubscribes'] == 1
    assert metrics['uniqueOpens'] == 1
    assert metrics['uniqueUnsubscribes'] == 1


def test_missing_councillor_header():
    req = func.HttpRequest(method='GET', url='http://localhost/api/distribution-lists', headers={}, params={}, route_params={}, body=b'')
    resp = function_app.distribution_lists(req)
    assert resp.status_code == 400


def test_delete_distribution_list(councillor_id):
    # Create a list
    create_resp = function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "Temp", "description": "d"}))
    assert create_resp.status_code == 201
    list_id = json.loads(create_resp.get_body())['id']
    # Delete it
    del_resp = function_app.delete_distribution_list(_req('DELETE', f'/distribution-lists/{list_id}', councillor_id, route_params={'listId': list_id}))
    assert del_resp.status_code == 200
    # Verify not present
    lists = json.loads(function_app.distribution_lists(_req('GET', '/distribution-lists', councillor_id)).get_body())['items']
    assert all(li['id'] != list_id for li in lists)


def test_delete_contact(councillor_id):
    # Create list + contact
    list_id = json.loads(function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "L1", "description": "d"})).get_body())['id']
    contact_resp = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "del@example.com", "firstName": "Del", "lastName": "User"}))
    assert contact_resp.status_code == 201
    contact_id = json.loads(contact_resp.get_body())['id']
    # Delete contact
    del_resp = function_app.delete_contact(_req('DELETE', f'/contacts/{contact_id}', councillor_id, route_params={'contactId': contact_id}))
    assert del_resp.status_code == 200
    contacts = json.loads(function_app.contacts(_req('GET', '/contacts', councillor_id)).get_body())['items']
    assert all(c['id'] != contact_id for c in contacts)


def test_delete_campaign(councillor_id):
    # Create campaign prerequisites
    list_id = json.loads(function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "L2", "description": "d"})).get_body())['id']
    contact_resp = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "c2@example.com", "firstName": "C2", "lastName": "User"}))
    assert contact_resp.status_code == 201
    camp_resp = _resolve(function_app.campaigns(_req('POST', '/campaigns', councillor_id, {"subject": "S", "content": "Body", "listIds": [list_id]})))
    assert camp_resp.status_code == 201
    camp_id = json.loads(camp_resp.get_body())['id']
    # Delete
    del_resp = function_app.delete_campaign(_req('DELETE', f'/campaigns/{camp_id}', councillor_id, route_params={'campaignId': camp_id}))
    assert del_resp.status_code == 200
    campaigns = json.loads(_resolve(function_app.campaigns(_req('GET', '/campaigns', councillor_id))).get_body())['items']
    assert all(c['id'] != camp_id for c in campaigns)


def test_unsubscribe_endpoints(councillor_id):
    # Seed contact + campaign
    list_id = json.loads(function_app.distribution_lists(_req('POST', '/distribution-lists', councillor_id, {"name": "Unsub", "description": "d"})).get_body())['id']
    contact_resp = function_app.add_contact(_req('POST', f'/distribution-lists/{list_id}/contacts', councillor_id, {"email": "unsubscribe@example.com", "firstName": "U", "lastName": "Ser"}))
    contact_id = json.loads(contact_resp.get_body())['id']
    camp_resp = _resolve(function_app.campaigns(_req('POST', '/campaigns', councillor_id, {"subject": "Info", "content": "Body", "listIds": [list_id]})))
    camp_id = json.loads(camp_resp.get_body())['id']

    # Record backend unsubscribe event
    function_app.track_unsubscribe(_req('POST', '/track/unsubscribe', councillor_id, {"campaignId": camp_id, "contactId": contact_id}))

    # Ensure GET returns entry
    list_resp = function_app.unsubscribes(_req('GET', '/unsubscribes', councillor_id))
    assert list_resp.status_code == 200
    unsub_items = json.loads(list_resp.get_body())['items']
    assert any(u['email'] == 'unsubscribe@example.com' for u in unsub_items)

    # Manual add via POST
    manual_email = 'manual-unsub@example.com'
    manual_resp = function_app.unsubscribes(_req('POST', '/unsubscribes', councillor_id, {"email": manual_email}))
    assert manual_resp.status_code == 201
    manual_id = json.loads(manual_resp.get_body())['id']

    # Delete by email via query
    del_email_resp = function_app.unsubscribes(_req('DELETE', '/unsubscribes', councillor_id, query={'email': manual_email}))
    assert del_email_resp.status_code == 200

    # Delete by id route
    del_id_resp = function_app.delete_unsubscribe(_req('DELETE', f'/unsubscribes/{manual_id}', councillor_id, route_params={'unsubscribeId': manual_id}))
    assert del_id_resp.status_code in {200, 404}  # id may already be removed by email deletion