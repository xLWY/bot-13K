const SNOWFLAKE_RE = /^\d{15,20}$/;

/**
 * Retourne la liste des rôles staff du système de tickets.
 * `ticketStaffRoleIds` est la nouvelle source ; `ticketStaffRoleId` reste
 * supporté pour les anciennes configurations.
 */
export function getTicketStaffRoleIds(config) {
    const source = config && typeof config === 'object' ? config : {};
    const ids = [];

    const add = (id) => {
        const value = String(id ?? '').trim();
        if (!SNOWFLAKE_RE.test(value) || ids.includes(value)) return;
        ids.push(value);
    };

    if (Array.isArray(source.ticketStaffRoleIds)) {
        for (const id of source.ticketStaffRoleIds) add(id);
    }
    add(source.ticketStaffRoleId);

    return ids;
}

export function formatTicketStaffRoles(config) {
    const ids = getTicketStaffRoleIds(config);
    return ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`Non défini`';
}
