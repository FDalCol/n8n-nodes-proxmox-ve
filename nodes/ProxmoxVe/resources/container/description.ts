import { guestDescription, guestOperations } from '../../shared/guest';

export const containerOperations = guestOperations('lxc');
export const containerDescription = guestDescription('lxc', 'container');
