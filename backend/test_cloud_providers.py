import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
from config import settings
from cloud_providers import (BLACKBOX_URL, blackbox_eligibility, complete,
                             configured_providers, provider_status)


class Response:
    def __init__(self, status, data=None): self.status_code, self._data = status, data or {}
    def json(self): return self._data


class Client:
    def __init__(self, responses): self.responses, self.calls = list(responses), []
    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs)); return self.responses.pop(0)


class CloudProviderTests(unittest.IsolatedAsyncioTestCase):
    def cfg(self, **values):
        defaults = dict(GROQ_API_KEY='', GROQ_MODEL='groq-model', BLACKBOX_ENABLED=False,
                        BLACKBOX_API_KEY='', BLACKBOX_MODEL='blackboxai/minimax/minimax-m2.5',
                        BLACKBOX_FREE_MODELS='')
        defaults.update(values)
        return patch.multiple(settings, **defaults)

    def test_missing_keys_means_offline_only(self):
        with self.cfg():
            self.assertEqual(configured_providers(), [])
            self.assertFalse(provider_status()['groq']['configured'])

    def test_blackbox_disabled_even_with_key(self):
        with self.cfg(BLACKBOX_API_KEY='secret'):
            self.assertEqual(blackbox_eligibility(), (False, 'disabled'))

    def test_blackbox_requires_explicit_free_access_attestation(self):
        with self.cfg(BLACKBOX_ENABLED=True, BLACKBOX_API_KEY='secret'):
            self.assertEqual(blackbox_eligibility(), (False, 'free_access_not_attested'))

    def test_blackbox_uses_official_public_endpoint(self):
        with self.cfg(BLACKBOX_ENABLED=True, BLACKBOX_API_KEY='secret',
                      BLACKBOX_FREE_MODELS='blackboxai/minimax/minimax-m2.5'):
            specs = configured_providers()
            self.assertEqual(specs[0].url, BLACKBOX_URL)
            self.assertEqual(BLACKBOX_URL, 'https://api.blackbox.ai/chat/completions')

    async def test_groq_success_is_primary(self):
        c = Client([Response(200, {'choices': [{'message': {'content': 'ok'}}]})])
        with self.cfg(GROQ_API_KEY='rotated-secret', BLACKBOX_ENABLED=True,
                      BLACKBOX_API_KEY='bb-secret', BLACKBOX_FREE_MODELS='blackboxai/minimax/minimax-m2.5'):
            out = await complete([{'role': 'user', 'content': 'hi'}], client=c)
            self.assertEqual(out['_friday_provider'], 'groq')
            self.assertEqual(len(c.calls), 1)
            self.assertNotIn('rotated-secret', str(out))

    async def test_invalid_groq_falls_back_to_explicit_blackbox(self):
        c = Client([Response(401), Response(200, {'choices': [{'message': {'content': 'fallback'}}]})])
        with self.cfg(GROQ_API_KEY='bad', BLACKBOX_ENABLED=True, BLACKBOX_API_KEY='valid',
                      BLACKBOX_FREE_MODELS='blackboxai/minimax/minimax-m2.5'):
            out = await complete([{'role': 'user', 'content': 'hi'}], client=c)
            self.assertEqual(out['_friday_provider'], 'blackbox')
            self.assertEqual([x[0] for x in c.calls][-1], BLACKBOX_URL)

    async def test_tools_forwarded_without_logging_keys(self):
        c = Client([Response(200, {'choices': [{'message': {'tool_calls': []}}]})])
        tools = [{'type': 'function', 'function': {'name': 'tell_time'}}]
        with self.cfg(GROQ_API_KEY='never-print-me'):
            out = await complete([{'role': 'user', 'content': 'time'}], tools=tools, client=c)
            self.assertEqual(c.calls[0][1]['json']['tools'], tools)
            self.assertNotIn('never-print-me', str(out))


if __name__ == '__main__': unittest.main()
