import os
import smtplib
import logging
from email.message import EmailMessage
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api", tags=["contact"])
logger = logging.getLogger(__name__)


class ContactPayload(BaseModel):
    name: str
    email: EmailStr
    topic: str
    message: str


def _load_smtp_settings():
    host = os.getenv("SMTP_HOST")
    port_raw = os.getenv("SMTP_PORT")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("SMTP_FROM")
    recipient = os.getenv("SMTP_TO")

    missing = [key for key, val in {
        "SMTP_HOST": host,
        "SMTP_PORT": port_raw,
        "SMTP_FROM": sender,
        "SMTP_TO": recipient,
    }.items() if not val]
    if missing:
        raise HTTPException(status_code=500, detail=f"SMTP config missing: {', '.join(missing)}")

    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=500, detail="SMTP_PORT must be an integer")

    return host, port, user, password, sender, recipient


def _send_email(payload: ContactPayload):
    host, port, user, password, sender, recipient = _load_smtp_settings()

    msg = EmailMessage()
    msg["Subject"] = f"[Nucleomic Contact] {payload.topic}"
    msg["From"] = sender
    msg["To"] = recipient
    body = (
        f"Name: {payload.name}\n"
        f"Email: {payload.email}\n"
        f"Topic: {payload.topic}\n\n"
        f"{payload.message}"
    )
    msg.set_content(body)

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
                if user and password:
                    smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                smtp.starttls()
                if user and password:
                    smtp.login(user, password)
                smtp.send_message(msg)
    except Exception as exc:
        logger.exception("Contact email send failed")
        raise HTTPException(status_code=500, detail=f"Failed to send message: {exc}")


@router.post("/contact")
async def send_contact(payload: ContactPayload):
    _send_email(payload)
    return {"ok": True}
