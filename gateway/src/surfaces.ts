/** Composition root: registering a surface is the only gateway wiring it needs. */
import type { SecretReader, Surface } from '@agent-squad/kernel';
import { createIMessageSurface } from '@agent-squad/surface-imessage';
import { createWhatsAppSurface } from '@agent-squad/surface-whatsapp';
import { createA2ASurface } from '@agent-squad/surface-a2a';
import { join } from 'node:path';
export function createSurfaces(host:{directory:string;helper:string;secret:SecretReader}):Surface[] {
  return [createIMessageSurface({helper:host.helper}),createWhatsAppSurface({directory:join(host.directory,'whatsapp')}),createA2ASurface({secret:host.secret})];
}
