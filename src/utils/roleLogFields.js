const MAX_DISPLAYED_ROLE_PERMISSIONS = 5;

export function buildRoleAuditFields(role, { includeMemberCount = false } = {}) {
  const fields = [
    {
      name: '🏷️ Nom du rôle',
      value: role.name,
      inline: true
    },
    {
      name: '🎨 Couleur',
      value: role.hexColor || '#000000',
      inline: true
    },
    {
      name: '🆔 ID du rôle',
      value: role.id,
      inline: true
    }
  ];

  const permissions = role.permissions.toArray();
  if (permissions.length > 0) {
    const displayPerms = permissions.slice(0, MAX_DISPLAYED_ROLE_PERMISSIONS).join(', ');
    fields.push({
      name: '🔐 Permissions',
      value: permissions.length > MAX_DISPLAYED_ROLE_PERMISSIONS
        ? `${displayPerms}... (+${permissions.length - MAX_DISPLAYED_ROLE_PERMISSIONS} de plus)`
        : displayPerms,
      inline: false
    });
  }

  fields.push(
    {
      name: '✅ Affiché séparément',
      value: role.hoist ? 'Oui' : 'Non',
      inline: true
    },
    {
      name: '🤖 Géré par le bot',
      value: role.managed ? 'Oui (rôle du bot)' : 'Non',
      inline: true
    },
    {
      name: '📍 Position',
      value: role.position.toString(),
      inline: true
    }
  );

  if (includeMemberCount) {
    fields.push({
      name: '👥 Membres avec ce rôle',
      value: role.members.size.toString(),
      inline: true
    });
  }

  return fields;
}
