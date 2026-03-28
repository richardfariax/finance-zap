export function normalizeVoiceNoteText(raw: string): string {
  let t = raw.replace(/\s+/gu, ' ').trim();
  if (!t) return t;

  const leadingFillers =
    /^(oi|ola|olá|opa|e\s+a[ií]|ent[aã]o|é\s+que|é\s+o\s+seguinte|tipo\s+assim|tipo)\b[,.!?:]?\s+/iu;
  for (let i = 0; i < 3 && leadingFillers.test(t); i += 1) {
    t = t.replace(leadingFillers, '').trim();
  }

  t = t.replace(/\breais\s+reais\b/giu, 'reais');
  t = t.replace(/\breal\s+reais\b/giu, 'reais');
  t = t.replace(/\br\s*\$\s*/giu, 'R$ ');
  t = t.replace(/\bpause\b/giu, ' ');
  t = t.replace(/\s+/gu, ' ').trim();
  return t;
}
