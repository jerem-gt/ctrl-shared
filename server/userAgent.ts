function browserOf(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) {
    return 'Edge';
  }
  if (/OPR\/|Opera/.test(ua)) {
    return 'Opera';
  }
  if (/Firefox\/|FxiOS\//.test(ua)) {
    return 'Firefox';
  }
  if (/Chrome\/|CriOS\//.test(ua)) {
    return 'Chrome';
  }
  if (/Safari\//.test(ua)) {
    return 'Safari';
  }
  return null;
}

function osOf(ua: string): string | null {
  if (/Android/.test(ua)) {
    return 'Android';
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return 'iOS';
  }
  if (/Windows/.test(ua)) {
    return 'Windows';
  }
  if (/Mac OS X|Macintosh/.test(ua)) {
    return 'macOS';
  }
  if (/Linux|X11/.test(ua)) {
    return 'Linux';
  }
  return null;
}

/** Libellé « Navigateur · OS » déduit du User-Agent ; vide si rien n'est reconnu. */
export function deviceLabel(userAgent = ''): string {
  return [browserOf(userAgent), osOf(userAgent)].filter((part) => part !== null).join(' · ');
}
