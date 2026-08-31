# contracts — vendored copy, do not edit here

The source of truth lives in the `ksp-contracts` repository at
`packages/contracts/src`. This directory is a copy so that this application
builds without resolving a private package from a registry.

To change a schema, edit it there and re-run `npm run sync:contracts`, which
overwrites this directory in all three applications.

Editing these files directly will be silently overwritten on the next sync, and
will drift from the API's validation in the meantime.
