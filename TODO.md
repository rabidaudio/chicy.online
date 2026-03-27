# TODO

- refactor state machines to be a lot more explicit and well defined
  - rename site ready to unpublished
- new features
  - rename sites
  - user caps
  - error pages
    - https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-custom-error-pages.html
    - allowed codes: 400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504
  - rollback -n 1
  - anon auth provider (for custom deployments, etc)
    - generates random user id and auth token that never changes. or password?
  - json vs text outputs from cli
  - cleanup timer task
  - sns topic for tracking deployment/promotion logs
  - multiple custom domains
    - array on site, since limit is 4
- frontend
- Custom deployments
  - flag for controlling enabled auth providers

- document verification of apex records
  - alias record: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
  - txt verification record: https://repost.aws/questions/QU6jYSBETpTF6sKyBZsK5L8A/cloudfront-saas-manager-broken-integration-with-zone-apex-dns-records-alias-records
