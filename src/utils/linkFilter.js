const URL_PATTERN =
  /(?<![\w.-])(?:(?:https?:\/\/|www\.)[^\s<>"'`\[\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'`\[\]]*)/gi;

const SHORTENER_HOSTS = [
  'adf.ly',
  'bit.do',
  'bit.ly',
  'buff.ly',
  'clck.ru',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'ow.ly',
  'rb.gy',
  'rebrand.ly',
  's.id',
  'short.gy',
  'shorte.st',
  'shorturl.at',
  'soo.gd',
  't.co',
  't.ly',
  'tiny.cc',
  'tiny.one',
  'tinyurl.com',
  'urlz.fr',
  'v.gd'
];

const INVITE_DOMAINS = new Set([
  'discord.gg',
  'discordapp.gg',
  'discord.com',
  'discordapp.com',
  'discord.me',
  'discord.io',
  'dsc.gg',
  'invite.gg'
]);

function baseHost(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .trim()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

function normalizeInviteHost(hostname) {
  return baseHost(hostname).replace(/^(?:ptb|canary)\./, '');
}

export function normalizeObfuscatedText(text) {
  const value = String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\\+(?=[./])/g, '')
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)|\{dot\}|<\.>/gi, '.')
    .replace(/\s+(?:dot|point)\s+/gi, '.')
    .replace(/\s+(?:slash)\s+/gi, '/')
    .replace(/[／∕⁄]/g, '/')
    .replace(/[。．｡]/g, '.');

  return value
    .replace(
      /\b(discord(?:app)?|dsc|invite)\s*\.\s*(gg|com|me|io)\b/gi,
      '$1.$2'
    )
    .replace(
      /\b(discord(?:app)?|dsc|invite)\.(gg|com|me|io)\s*\/\s*invite\s*\/\s*([a-z0-9_-]+)/gi,
      '$1.$2/invite/$3'
    )
    .replace(
      /\b(discord(?:app)?|dsc|invite)\.(gg|com|me|io)\s*\/\s*([a-z0-9_-]+)/gi,
      '$1.$2/$3'
    );
}

function cleanRawUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[<([{]+/, '')
    .replace(/[>)\]}]?[.,!?;:'"`]+$/, '')
    .replace(/[>)\]}]$/, '');
}

function parseLink(raw) {
  const cleaned = cleanRawUrl(raw);
  if (!cleaned) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)
    ? cleaned
    : `https://${cleaned}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(parsed.protocol)) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname.includes('.')) return null;

  return {
    url: parsed.href,
    hostname,
    pathname: parsed.pathname
  };
}

export function extractLinks(text) {
  const normalized = normalizeObfuscatedText(text);
  const matches = normalized.match(URL_PATTERN) || [];
  const links = [];
  const seen = new Set();

  for (const match of matches) {
    const link = parseLink(match);
    if (!link) continue;

    const key = link.url.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    links.push(link);
  }

  return links;
}

export function parseDiscordInvite(link) {
  if (!link?.hostname) return null;

  const host = normalizeInviteHost(link.hostname);
  if (!INVITE_DOMAINS.has(host)) return null;

  const parts = String(link.pathname || '')
    .split('/')
    .map(part => part.trim())
    .filter(Boolean);

  let code;

  if (host === 'discord.com' || host === 'discordapp.com') {
    if (parts[0] !== 'invite') return null;
    code = parts[1];
  } else {
    code = parts[0] === 'invite' ? parts[1] : parts[0];
  }

  code = String(code || '').replace(/[^a-z0-9_-].*$/i, '');
  if (!code) return null;

  return {
    code: code.toLowerCase(),
    url: link.url,
    hostname: host
  };
}

export function findDiscordInvites(text) {
  return extractLinks(text)
    .map(parseDiscordInvite)
    .filter(Boolean);
}

export function normalizeAllowedDomains(value) {
  const raw = Array.isArray(value)
    ? value.flatMap(entry => String(entry || '').split(/[\s,;]+/))
    : String(value || '').split(/[\s,;]+/);

  const domains = new Set();

  for (const entry of raw) {
    let domain = String(entry || '').toLowerCase().trim();
    if (!domain) continue;

    domain = domain
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^www\./, '')
      .replace(/^\*\./, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/\.$/, '');

    if (domain.length > 253) continue;
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) continue;

    domains.add(domain);
    if (domains.size >= 50) break;
  }

  return [...domains];
}

export function isAllowedDomain(hostname, allowedDomains = []) {
  const host = baseHost(hostname);
  if (!host) return false;

  const domains = Array.isArray(allowedDomains) ? allowedDomains : [allowedDomains];

  return domains.some(domain => {
    const allowed = baseHost(domain).replace(/^\*\./, '');
    return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function isShortener(hostname) {
  const host = baseHost(hostname);
  return SHORTENER_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

export function detectLinkViolation(content, config = {}, ownInviteCodes = new Set()) {
  const links = extractLinks(content);
  if (links.length === 0) return null;

  const allowedOwnInvites = ownInviteCodes instanceof Set
    ? ownInviteCodes
    : new Set(ownInviteCodes);

  if (config.blockInvites) {
    for (const link of links) {
      const invite = parseDiscordInvite(link);
      if (!invite || allowedOwnInvites.has(invite.code)) continue;

      return {
        type: 'invite',
        reason: `Invitation Discord non autorisée (${invite.hostname})`,
        linkHost: invite.hostname,
        messageCount: 1,
        linkCount: 1
      };
    }
  }

  if (!config.blockLinks && !config.blockShorteners) return null;

  for (const link of links) {
    const invite = parseDiscordInvite(link);
    if (invite && allowedOwnInvites.has(invite.code)) continue;
    if (isAllowedDomain(link.hostname, config.allowedDomains)) continue;

    if (config.blockLinks) {
      return {
        type: 'link',
        reason: `Lien externe non autorisé (${link.hostname})`,
        linkHost: link.hostname,
        messageCount: 1,
        linkCount: 1
      };
    }

    if (config.blockShorteners && isShortener(link.hostname)) {
      return {
        type: 'shortener',
        reason: `Lien raccourci non autorisé (${link.hostname})`,
        linkHost: link.hostname,
        messageCount: 1,
        linkCount: 1
      };
    }
  }

  return null;
}
