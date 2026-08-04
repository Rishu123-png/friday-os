# FRIDAY OS — Text embeddings (semantic memory / meaning-recall).
# sentence-transformers is an optional heavy dep. Without it, /v1/embed
# returns 503 and the app keeps its on-device embedding path.
_encoder = None


def _get_encoder(model_name: str):
    global _encoder
    if _encoder is not None:
        return _encoder
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise RuntimeError(
            "Embedding model not installed on server — run: pip install sentence-transformers")
    _encoder = SentenceTransformer(model_name)
    return _encoder


def embed_texts(texts: list[str], model_name: str) -> list[list[float]]:
    enc = _get_encoder(model_name)
    vecs = enc.encode([t[:512] for t in texts], normalize_embeddings=True)
    return [v.tolist() for v in vecs]
