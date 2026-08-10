from __future__ import annotations

import logging
from xml.sax.saxutils import escape

from app.config import Settings, get_settings
from app.models import TwilioVoiceGather

logger = logging.getLogger(__name__)


class TwilioVoiceService:
    """Incoming calls: STT gather, TTS responses, dispatch to AI trip flow."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._enabled = bool(
            self.settings.twilio_account_sid and self.settings.twilio_auth_token
        )
        if self._enabled:
            from twilio.rest import Client

            self._client = Client(
                self.settings.twilio_account_sid,
                self.settings.twilio_auth_token,
            )
        else:
            self._client = None
            logger.warning("Twilio Voice: disabled (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)")

    @property
    def enabled(self) -> bool:
        return self._enabled

    def welcome_twiml(self) -> str:
        action = f"{self.settings.public_base_url.rstrip('/')}/voice/gather"
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{escape(action)}" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">Welcome to My Ride. Where would you like to go?</Say>
  </Gather>
  <Say>We did not hear you. Goodbye.</Say>
</Response>"""

    def gather_twiml(self, gather: TwilioVoiceGather, reply: str) -> str:
        action = f"{self.settings.public_base_url.rstrip('/')}/voice/gather"
        speech = gather.speech_result or gather.digits or ""
        logger.info("Voice gather call=%s speech=%r", gather.call_sid, speech)
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">{escape(reply)}</Say>
  <Gather input="speech" action="{escape(action)}" method="POST" speechTimeout="auto">
    <Say>Anything else I can help with?</Say>
  </Gather>
</Response>"""

    def dispatch_twiml(self, message: str) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">{escape(message)}</Say>
  <Pause length="1"/>
  <Say>Your driver will call when assigned. Thank you for riding with My Ride.</Say>
</Response>"""

    async def outbound_call(self, to_number: str, message: str) -> dict:
        if not self._enabled:
            return {"sid": "CA_dev", "to": to_number, "dev_mode": True}
        call = self._client.calls.create(
            twiml=self.dispatch_twiml(message),
            to=to_number,
            from_=self.settings.twilio_phone_number,
        )
        return {"sid": call.sid, "status": call.status}


_voice: TwilioVoiceService | None = None


def get_voice() -> TwilioVoiceService:
    global _voice
    if _voice is None:
        _voice = TwilioVoiceService()
    return _voice
