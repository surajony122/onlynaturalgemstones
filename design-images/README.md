# Design image backup

A copy of every picture the storefront's design chooser uses (the list in the
theme snippet `snippets/shubh-gems-global-designs.liquid`), saved with the exact
filenames the theme expects. 80 files, all JPEG, about 700 KB in total.

If Shopify admin -> Content -> Files ever loses one, upload the file from here
back to Files under the SAME name. `manifest.json` lists each file with the
address it was copied from and a SHA-256 checksum.

`PD13-silver.jpg` and `PD08-gold.jpg` are also stored inside the theme itself
(`assets/`) and the theme points at those copies.
