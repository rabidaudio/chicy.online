# [static-chic.online](https://static-chic.online)

A multi-tenant static site host. Sites are stored in S3 buckets and served via CloudFront. Supports custom domains and arbitrary rollbacks.

```bash
npm install -g git+https://github.com/rabidaudio/static-chic.online.git

statchic init # login with Github and create a site
statchic deploy --promote --wait path/to/dist # publish data
statchic configure --domain mydomain.com # set up a custom domain
```
