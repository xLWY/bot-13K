import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { EVENT_TYPES } from '../services/loggingService.js';

const EVENT_TYPES_BY_CATEGORY = Object.values(EVENT_TYPES).reduce((accumulator, eventType) => {
  const [category] = eventType.split('.');
  if (!accumulator[category]) {
    accumulator[category] = [];
  }
  accumulator[category].push(eventType);
  return accumulator;
}, {});

const DASHBOARD_CATEGORY_EMOJIS = {
  moderation: '🔨',
  ticket: '🎫',
  message: '✉️',
  role: '🏷️',
  member: '👥',
  leveling: '📈',
  reactionrole: '🎭',
  giveaway: '🎁',
  counter: '📊',
};

const DASHBOARD_CATEGORY_LABELS = {
  moderation: 'Modération',
  ticket: 'Tickets',
  message: 'Messages',
  role: 'Rôles',
  member: 'Membres',
  leveling: 'Niveaux',
  reactionrole: 'Rôles réaction',
  giveaway: 'Concours',
  counter: 'Compteurs',
};

function categoryLabel(category) {
  return DASHBOARD_CATEGORY_LABELS[category] ||
    category.charAt(0).toUpperCase() + category.slice(1);
}

function createDashboardCategoryButtons(enabledEvents = {}, loggingEnabled = false) {
  const categories = ['moderation', 'ticket', 'message', 'role', 'member', 'leveling', 'reactionrole', 'giveaway', 'counter'];
  const buttons = categories.map((category) => {
    const wildcardDisabled = enabledEvents[`${category}.*`] === false;
    const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
    const allEnabled = categoryEvents.length === 0
      ? true
      : categoryEvents.every((t) => enabledEvents[t] !== false);
    const isEnabled = loggingEnabled && !wildcardDisabled && allEnabled;
    const emoji = DASHBOARD_CATEGORY_EMOJIS[category] || '📌';
    const label = `${emoji} ${categoryLabel(category)}`;
    return new ButtonBuilder()
      .setCustomId(`log_dash_toggle:${category}.*`)
      .setLabel(label)
      .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

export function createLoggingDashboardComponents(enabledEvents, loggingEnabled = false) {
  const categoryRows = createDashboardCategoryButtons(enabledEvents, loggingEnabled);
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('log_dash_toggle:audit_enabled')
      .setLabel(loggingEnabled ? '🧾 Audit : activé' : '🧾 Audit : désactivé')
      .setStyle(loggingEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('log_dash_toggle:all')
      .setLabel('Basculer tout')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('log_dash_refresh')
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Primary),
  );
  return [...categoryRows, actionRow];
}





export function createLoggingButtons() {
  const buttons = [
    
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.MODERATION_BAN}`)
        .setLabel('🔨 Modération')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.TICKET_CREATE}`)
        .setLabel('🎫 Tickets')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.MESSAGE_DELETE}`)
        .setLabel('❌ Messages')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.ROLE_CREATE}`)
        .setLabel('🏷️ Rôles')
        .setStyle(ButtonStyle.Secondary)
    ),
    
    
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.MEMBER_JOIN}`)
        .setLabel('👋 Arrivées/Départs')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.LEVELING_LEVELUP}`)
        .setLabel('📈 Niveaux')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.REACTION_ROLE_ADD}`)
        .setLabel('🎭 Rôles réaction')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${EVENT_TYPES.GIVEAWAY_CREATE}`)
        .setLabel('🎁 Concours')
        .setStyle(ButtonStyle.Secondary)
    ),

    
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('logging_toggle:counter.*')
        .setLabel('📊 Compteurs')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('logging_toggle:all')
        .setLabel('Basculer tout')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('logging_refresh_status')
        .setLabel('🔄 Actualiser')
        .setStyle(ButtonStyle.Primary)
    )
  ];

  return buttons;
}






export function getButtonStatusStyle(isEnabled) {
  return isEnabled ? ButtonStyle.Success : ButtonStyle.Danger;
}






export function createStatusIndicatorButtons(enabledEvents = {}, loggingEnabled = false) {
  const eventCategories = ['moderation', 'ticket', 'message', 'role', 'member', 'leveling', 'reactionrole', 'giveaway', 'counter'];
  const buttons = [];

  for (const category of eventCategories) {
    const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
    const categoryWildcardDisabled = enabledEvents[`${category}.*`] === false;
    const categoryEventsEnabled = categoryEvents.length === 0
      ? true
      : categoryEvents.every((eventType) => enabledEvents[eventType] !== false);
    const isEnabled = loggingEnabled && !categoryWildcardDisabled && categoryEventsEnabled;

    const emoji = {
      'moderation': '🔨',
      'ticket': '🎫',
      'message': '❌',
      'role': '🏷️',
      'member': '👋',
      'leveling': '📈',
      'reactionrole': '🎭',
      'giveaway': '🎁',
      'counter': '📊'
    }[category] || '📌';

    buttons.push(
      new ButtonBuilder()
        .setCustomId(`logging_toggle:${category}.*`)
        .setLabel(`${emoji} ${categoryLabel(category)}`)
        .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
    );
  }

  if (buttons.length === 0) {
    return [];
  }

  
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const rowButtons = buttons.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(rowButtons));
  }

  return rows;
}

export function createLoggingStatusComponents(enabledEvents, loggingEnabled = false) {
  const categoryRows = createStatusIndicatorButtons(enabledEvents, loggingEnabled);

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('logging_toggle:audit_enabled')
      .setLabel(loggingEnabled ? '🧾 Audit : activé' : '🧾 Audit : désactivé')
      .setStyle(loggingEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('logging_toggle:all')
      .setLabel('Basculer les catégories')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('logging_refresh_status')
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Primary)
  );

  return [...categoryRows, actionRow];
}






export function parseEventTypeFromButton(customId) {
  if (!customId.startsWith('logging_toggle:')) {
    return null;
  }

  return customId.replace('logging_toggle:', '');
}
