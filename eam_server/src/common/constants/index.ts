/**
 * Centralized barrel for eam_server's non-deployment constants (protocol
 * bytes, fixed formats, magic values) — as opposed to deployment config,
 * which always comes from ConfigService/.env, never from a file here.
 *
 * Import from this path rather than an individual file, e.g.:
 *   import { UDP_DISCOVERY_PORT, INNER_FUNCTION_CODE } from '../common/constants';
 *
 * Add new domains as their own file here (e.g. `mqtt-protocol.constants.ts`)
 * and re-export it below as the server grows beyond just the inverter.
 */
export * from './inverter-protocol.constants';
