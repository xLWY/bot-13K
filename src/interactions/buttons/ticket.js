import createTicketHandler, {
  createTicketDirectHandler,
  closeTicketHandler,
  claimTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
} from '../../handlers/ticketButtons.js';

export default [
  createTicketHandler,
  createTicketDirectHandler,
  closeTicketHandler,
  claimTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
];