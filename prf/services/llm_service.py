"""
Unified LLM service — OpenAI first, Gemini fallback.

All AI features (essay correction, OCR, tutor, lesson generation) route through
here so the provider can be swapped in one place. Provider selection:
  1. OPENAI_API_KEY set  -> OpenAI
  2. GOOGLE_API_KEY set  -> Gemini
  3. neither             -> raises LLMUnavailable
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
GEMINI_MODEL = os.getenv("GOOGLE_MODEL", "gemini-2.5-flash")


class LLMUnavailable(RuntimeError):
    """Raised when no LLM provider is configured."""


def active_provider() -> Optional[str]:
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("GOOGLE_API_KEY"):
        return "gemini"
    return None


def _openai_client():
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def chat(
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 1500,
    json_mode: bool = False,
) -> str:
    """
    Send a chat completion. `messages` uses the OpenAI role format
    ({"role": "system"|"user"|"assistant", "content": str}).
    Returns the assistant's text response.
    """
    provider = active_provider()
    if provider is None:
        raise LLMUnavailable("No LLM provider configured")

    if provider == "openai":
        client = _openai_client()
        kwargs = {
            "model": OPENAI_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await client.chat.completions.create(**kwargs)
        return (resp.choices[0].message.content or "").strip()

    # Gemini fallback
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

    system_parts = [m["content"] for m in messages if m["role"] == "system"]
    history = []
    for m in messages:
        if m["role"] == "user":
            history.append({"role": "user", "parts": [m["content"]]})
        elif m["role"] == "assistant":
            history.append({"role": "model", "parts": [m["content"]]})

    model = genai.GenerativeModel(
        GEMINI_MODEL,
        system_instruction="\n\n".join(system_parts) if system_parts else None,
    )
    if len(history) > 1:
        chat_session = model.start_chat(history=history[:-1])
        resp = chat_session.send_message(history[-1]["parts"][0])
    else:
        prompt = history[0]["parts"][0] if history else "\n\n".join(system_parts)
        resp = model.generate_content(prompt)
    return (resp.text or "").strip()


async def chat_json(
    messages: list[dict],
    temperature: float = 0.4,
    max_tokens: int = 2500,
) -> dict:
    """Chat completion that must return a JSON object. Strips markdown fences."""
    raw = await chat(messages, temperature=temperature, max_tokens=max_tokens, json_mode=True)
    return _parse_json(raw)


async def vision(
    prompt: str,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    max_tokens: int = 2000,
) -> str:
    """Send an image + prompt to a vision model. Returns the text response."""
    provider = active_provider()
    if provider is None:
        raise LLMUnavailable("No LLM provider configured")

    if provider == "openai":
        client = _openai_client()
        b64 = base64.b64encode(image_bytes).decode()
        resp = await client.chat.completions.create(
            model=OPENAI_VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                ],
            }],
            max_tokens=max_tokens,
        )
        return (resp.choices[0].message.content or "").strip()

    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
    model = genai.GenerativeModel(GEMINI_MODEL)
    resp = model.generate_content([prompt, {"mime_type": mime_type, "data": image_bytes}])
    return (resp.text or "").strip()


def _parse_json(raw: str) -> dict:
    """Parse a JSON response, tolerating markdown code fences."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.rstrip().endswith("```"):
            raw = raw.rstrip()[:-3]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            return json.loads(raw[start:end + 1])
        raise
