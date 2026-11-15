import json
import re
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
EXTENSIONS = ["jpg", "jpeg", "png", "webp"]
PREFIXES = ("jeux", "skill")

def titre_de(fichier: Path) -> str | None:
    texte = fichier.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"<title>(.*?)</title>", texte, re.I | re.S)
    return m.group(1).strip() if m else None

def image_de(stem: str) -> str | None:
    for dossier in ("", "images/"):
        for ext in EXTENSIONS:
            if (DOSSIER / f"{dossier}{stem}.{ext}").exists():
                return f"{dossier}{stem}.{ext}"
    return None

pages = []
for f in sorted(DOSSIER.glob("*.html")):
    if f.name == "index.html" or not f.name.lower().startswith(PREFIXES):
        continue
    pages.append({
        "file": f.name,
        "name": titre_de(f) or f.stem,
        "image": image_de(f.stem),
    })

donnees = json.dumps(pages, ensure_ascii=False, indent=2)
(DOSSIER / "pages.js").write_text(
    f"window.PAGES_DATA = {donnees};\n", encoding="utf-8"
)
print(f"{len(pages)} page(s) trouvée(s), pages.js créé.")