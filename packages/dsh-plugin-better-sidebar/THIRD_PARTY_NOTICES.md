# Third-party notices

This clean-room adapter follows the user-facing project file sidebar concept
from [`omdsh-dev/DSH-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar),
locked at commit `5d2d6e580143dc6ad95c015feb2909ec60afdf77` (MIT).

No upstream source, terminal implementation, `node-pty`, standalone `/sidebar`
HTTP API, or standalone WebSocket is included. The adapter uses only the
pinned Harness Connection RPC and `conversation.view` slot.
