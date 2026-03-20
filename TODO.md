# TODO

- change name and domain
- production deploy
  - callback url
  - cli env var configuration
  - https://github.com/settings/apps/static-chic-online
- new features
  - json vs text outputs from cli
  - error pages
    - https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-custom-error-pages.html
    - allowed codes: 400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504
  - rollback -n 1
  - rename sites
  - user caps
  - cleanup timer task
  - sns topic for tracking deployment state
- frontend
- Custom deployments
  - flag for controlling enabled auth providers
