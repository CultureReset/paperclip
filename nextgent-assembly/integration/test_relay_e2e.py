"""Real core + Python link + GCR HTTP/MCP routers; fixture DB and Paperclip sink.

Run from nextgent-platform with PYTHONPATH=src pytest ../../integration/test_relay_e2e.py.
No physical phone is attached. Its actual connection failure must become a FAILED receipt.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import httpx

from nextgent.link import Link, LinkConfig
from tests.test_core_service import HEADERS, client  # noqa: F401: existing pytest fixture


def test_ask_failure_receipt_and_delayed_cloud_delivery(client):
    process = subprocess.Popen(
        ['node', str(Path(__file__).with_name('relay-fixture.cjs'))],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    connection = json.loads(process.stdout.readline())
    cloud = httpx.Client(base_url=connection['url'], trust_env=False)
    link = None
    try:
        response = cloud.post('/api/mcp/ghost', headers={'Authorization': f"Bearer {connection['mcpToken']}"},
            json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {
                'name': 'nextgent_ghost_submit_intent', 'arguments': {
                    'text': 'open display settings', 'task_id': 'fixture-task', 'idempotency_key': 'fixture-intent-0001'
                }}})
        assert response.status_code == 200
        request = cloud.get('/__fixture').json()['tables']['ghost_node_requests'][0]

        def transport(req):
            result = client.request(req.method, req.url.path, headers=dict(req.headers), content=req.content)
            return httpx.Response(result.status_code, json=result.json())

        link = Link(LinkConfig(cloud_url=connection['url'] + '/api/nodes', node_token=connection['nodeToken'],
            core_token='t0k'), core_transport=httpx.MockTransport(transport))
        assert link.run_once() == 1
        action_id = 'act_relay_' + hashlib.sha256(request['id'].encode()).hexdigest()[:40]
        assert client.get('/actions/' + action_id, headers=HEADERS).json()['status'] == 'APPROVAL_REQUIRED'
        # The core accepted the intent, but GCR lost its answer. Lease recovery
        # redelivers the same instruction and reconciles the existing local action.
        cloud.post('/__fixture/lose-answer')
        assert link.run_once() == 1
        # Repeat delivery of the same relay request: no second action or approval message.
        link.forward(request)
        assert len(client.get('/sms/out', headers=HEADERS).json()['messages']) == 1
        code = client.get('/approvals', headers=HEADERS).json()[0]['code']
        wrong = client.post('/sms/in', headers=HEADERS, json={'message_id': 'wrong-owner',
            'sender': '+15550009999', 'body': 'YES ' + code})
        assert wrong.json()['handled'] == 'ignored'
        approved = client.post('/sms/in', headers=HEADERS, json={'message_id': 'owner-reply',
            'sender': '+15555550100', 'body': 'YES ' + code})
        assert approved.json()['handled'] == 'approved'
        receipt = client.get('/actions/' + action_id + '/receipt', headers=HEADERS).json()
        assert receipt['result'] == 'FAILED'
        assert link.sync_receipts() == 1
        assert client.get('/relay/receipts', headers=HEADERS).json()['receipts'] == []
        fixture = cloud.get('/__fixture').json()
        pending = [r for r in fixture['tables']['ghost_node_requests'] if r.get('receipt_error')]
        assert pending and not any(p['url'].endswith('/receipts') for p in fixture['posted'])
        cloud.post('/__fixture/online')
        link.run_once()
        delivered = [p for p in cloud.get('/__fixture').json()['posted'] if p['url'].endswith('/receipts')]
        assert len(delivered) == 1
        assert delivered[0]['body']['taskId'] == 'fixture-task'
        assert delivered[0]['body']['verified'] is False
        assert delivered[0]['body']['device'] == 'android.primary'
        assert 'x-nextgent-signature' in delivered[0]['headers']
        link.run_once()
        assert len([p for p in cloud.get('/__fixture').json()['posted'] if p['url'].endswith('/receipts')]) == 1
    finally:
        if link:
            link.cloud.close()
            link.core.close()
        cloud.post('/__fixture/stop')
        cloud.close()
        process.wait(timeout=10)
