import { guestDescription, guestOperations } from '../../shared/guest';

export const vmOperations = guestOperations('qemu');
export const vmDescription = guestDescription('qemu', 'vm');
