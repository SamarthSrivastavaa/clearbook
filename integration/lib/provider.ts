/**
 * Bridges an ethers `JsonRpcProvider` into the gluwa SDK's constructors.
 *
 * The problem is a dual-format type mismatch, not a runtime one. This project is
 * ESM (`"type": "module"`, `moduleResolution: nodenext`), so `import 'ethers'`
 * resolves ethers' **ESM** declarations. `@gluwa/usc-sdk` ships CommonJS, so its
 * `.d.ts` resolves ethers' **CommonJS** declarations. Both declare `#private` on
 * `JsonRpcApiProvider`, and TypeScript treats each `#private` in a declaration
 * file as a distinct nominal brand — so the two `JsonRpcApiProvider` types are
 * mutually unassignable despite being the same class at runtime:
 *
 *   error TS2345: Argument of type '...lib.esm/...JsonRpcApiProvider' is not
 *   assignable to parameter of type '...lib.commonjs/...JsonRpcApiProvider'
 *
 * The target type is derived from the SDK's own constructor rather than written
 * out, so it stays correct if the SDK changes what it accepts. The cast is
 * confined here; if the dual-package hazard is ever fixed upstream there is
 * exactly one place to delete.
 *
 * See KNOWN_ISSUES K-013.
 */
import type { JsonRpcProvider } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

/** Exactly the provider type the SDK's constructors accept. */
export type SdkProvider = ConstructorParameters<typeof chainInfo.PrecompileChainInfoProvider>[0];

/** Adapts an ethers provider for an SDK constructor. Runtime-identical. */
export function asSdkProvider(provider: JsonRpcProvider): SdkProvider {
  return provider as unknown as SdkProvider;
}
