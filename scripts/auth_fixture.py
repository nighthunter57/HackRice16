"""Authenticated HTTP fixtures for offline finance UI tests only.
The real account flows are covered separately by auth_smoke.py and auth:test.
"""
import json
USER_ID='00000000-0000-4000-8000-000000000001'
def authenticated_fixture(page):
    user={'id':USER_ID,'name':'Offline UI Test','email':'fixture@example.invalid','createdAt':'2026-09-01T00:00:00.000Z'}
    def reply(route,payload):
        headers={'Access-Control-Allow-Origin':route.request.headers.get('origin','http://127.0.0.1:8084'),'Access-Control-Allow-Credentials':'true'}
        route.fulfill(status=200,content_type='application/json',headers=headers,body=json.dumps(payload))
    page.route('**/api/auth/refresh',lambda route:reply(route,{'user':user,'accessToken':'ui-fixture-only'}))
    page.route('**/api/me',lambda route:reply(route,user))
