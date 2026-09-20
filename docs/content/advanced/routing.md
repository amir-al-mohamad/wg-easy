---
title: Policy Routing
---

Normally every client's traffic leaves the server the same way, through the
host's own internet connection. Policy routing lets you decide per destination
and per client where traffic goes instead: some of it through another VPN, some
of it straight out, some of it nowhere at all.

It also covers the other direction: forwarding a port from outside to one of
your clients.

Everything here lives under **Admin → Routing**. Until something is configured
there, the feature installs nothing: no chains, no rules, no listener.

## Adding a gateway

A _gateway_ is a network interface that traffic can be sent out through. You
create one by running a second VPN client alongside wg-easy; its interface then
shows up in the gateway list, ready to be switched on.

The container running it has to join wg-easy's network namespace:

```yaml
services:
    sing-box:
        image: ghcr.io/sagernet/sing-box
        network_mode: 'service:wg-easy' # (1)!
        cap_add:
            - NET_ADMIN
        volumes:
            - ./sing-box.json:/etc/sing-box/config.json:ro
        command: run -c /etc/sing-box/config.json
        depends_on:
            - wg-easy
        restart: unless-stopped
```

1. This is the part that matters. Without it the tunnel comes up perfectly well
   in its own namespace, where wg-easy can neither see nor route into it, and
   the gateway list simply stays empty. Use the `service:` form rather than
   `container:wg-easy`: Compose then recreates the sidecar whenever it
   recreates wg-easy. With `container:` the sidecar keeps running in the old,
   orphaned namespace after any recreate of wg-easy, its interface is nowhere
   wg-easy can see, and traffic for that gateway is dropped until the sidecar
   is recreated by hand.

Any protocol works as long as something presents a network interface.
WireGuard, AmneziaWG and OpenVPN do this themselves. A bare proxy protocol does
not: Xray serving VLESS over SOCKS creates no interface, so it needs a TUN front
end such as sing-box or tun2socks before it can be used as a gateway.

Switching a gateway on assigns it a packet mark and a routing table
automatically. You never need to pick those yourself, and they do not change for
the life of the gateway. The router uses routing tables 100–251 and `ip rule`
priorities 100–252; a sidecar configured to use the same numbers will be
overwritten.

### When a gateway goes away

A gateway can stop carrying traffic in two ways, and they mean different
things.

**Switched off by you.** Rules pointing at it fall through to the default
action, and a default route through it becomes direct. Off means off: the
gateway keeps its name, mark and table, but nothing is steered into it.

**Unavailable**, because the interface disappeared, went down, stopped
answering, or has no IPv6 to carry that family. What happens then is a choice
per gateway, **If unavailable**:

- **Drop traffic** (the default): traffic aimed at that gateway is dropped, not
  sent somewhere else. A rule that says "this goes through the VPN" must not
  quietly start going out the open internet because a tunnel died.
- **Send direct**: traffic goes the way it would with no gateway at all, out
  the host's connection. For a default route through a tunnel that sometimes
  fails, no tunnel can beat no internet; but choose this knowingly, because
  it is exactly the silent fallback the other setting exists to prevent.
- **Through another gateway**: traffic goes into the gateway you name instead.
  What happens when that one is unavailable too is decided by _its_ setting,
  so gateways form a chain from single choices: WARP, then a second VPN, then
  drop or direct. A chain that loops back on itself, or leads to a gateway
  that is switched off, ends in dropping.

Either way this holds at every moment, not only when routing is applied: each
gateway's routing table carries the routes through its fallbacks, and behind
them a standing route that ends the chain (a blackhole to drop, a throw to
the main table to go direct), each at a worse metric than the last. When the
kernel removes an interface's route along with the interface, the next route
in line is what remains. When an interface comes back, or was taken down and
up, or recreated faster than that could be noticed, the route through it is
restored automatically within about half a minute.

**Stopped answering** is judged for WireGuard gateways only, and only when a
peer has `PersistentKeepalive` set. A WireGuard link stays up whatever happens
at the far end (a dead endpoint, a revoked key and a healthy idle tunnel all
look the same), and its one sign of life is the handshake, which a peer with
keepalive renews at least every three minutes for as long as the far end
answers. A gateway whose keepalive peer has not handshaked for five minutes is
treated as unavailable: its route comes out, the chain moves on, and the route
goes back within half a minute of the next handshake. A peer without keepalive
is not judged, because an idle tunnel is silent for good reasons and pulling
its route would keep it idle.

**Reconnect**, on each WireGuard gateway in the list, discards the tunnel's
sessions and has it open a new one: a fresh handshake, possibly with a
different far end, and the routes through it back in place a second later.
The link itself is not touched (its addresses, its socket and whatever
routes it holds stay), so this is safe on a tunnel a sidecar owns. It is the
"turn it off and on again" of a stuck tunnel, done from the page rather than
the sidecar; if the far end has not answered within a few seconds the page
says so.

The gateway list shows all of this: switched off, up, missing and dropping,
missing and going direct, up but not answering, each in its own colour and
words.

### Gateways and IPv6

A gateway only carries IPv6 if its interface has a routable IPv6 address.
Upstreams built on a proxy protocol are frequently IPv4-only, and the gateway
list marks those.

IPv6 traffic aimed at such a gateway is discarded rather than routed. This is
deliberate: the kernel accepts an IPv6 default route through an interface that
has no IPv6 address and then sources the packets from its link-local address,
which the far end drops without logging anything. Failing visibly beats that.

IPv4 through the same gateway is unaffected. If none of your upstreams speak
IPv6, consider setting `DISABLE_IPV6=true` so clients are not handed IPv6 they
cannot use.

### Return traffic

Policy routing is asymmetric by nature: a reply comes back through the tunnel
while the kernel's reverse-path filter expects it on the uplink. wg-easy's own
compose file already relaxes `rp_filter` for its interface; if you run a gateway
container that sets it strictly on its own TUN device, replies through that
gateway are silently dropped. `net.ipv4.conf.<interface>.rp_filter=2` (loose) on
the gateway interface is the usual fix.

## The default route

One setting decides where traffic goes when no rule matches it:

| Default | Effect                                                     |
| ------- | ---------------------------------------------------------- |
| Direct  | Out the host's connection, exactly as without this feature |
| Gateway | Everything through the chosen gateway                      |
| Block   | Only traffic matched by a rule reaches the internet        |

Clients can always reach each other regardless of this setting.

## Rules

Rules are checked from top to bottom and **the first match decides**. Drag them,
or use the arrows, to change the order.

Each rule matches on domains, on addresses, or both:

| Pattern         | Matches                                  |
| --------------- | ---------------------------------------- |
| `example.com`   | that name only                           |
| `*.example.com` | subdomains, but not `example.com` itself |
| `.example.com`  | the name and its subdomains              |
| `*word*`        | any name containing `word`               |
| `*`             | every domain                             |

Addresses are plain IPv4 or IPv6, with or without a prefix length. `0.0.0.0/0`
and `::/0` mean all traffic.

A rule applies to every client unless you name specific ones, which is how you
send one device through a gateway while another goes direct on the same sites.

Each rule with domains also has:

- **Look up now**: resolve the domains immediately and add what comes back.
- **Keep addresses up to date**: resolve them again on a schedule, shortly
  before the previous answers expire.
- **Forget learned addresses**: drop everything the rule has learned, for when
  a service has moved and its old addresses are still being routed.

## How domain rules actually work

The addresses behind a name like `*.netflix.com` change constantly and differ by
region, so they cannot be listed ahead of time. Instead, with **Answer client
lookups on this server** switched on in the DNS section, wg-easy answers your
clients' DNS lookups itself and notes the addresses as they come back, adding
them to the matching rule.

It answers only on its own tunnel addresses, over UDP and TCP, and only to
clients on the tunnel. Lookups from a client are learned only into rules that
cover that client, and answers pointing at private, link-local or tunnel
addresses are never learned.

This only works for lookups it gets to see. **A client configured to use a public
resolver bypasses the whole mechanism**, and the failure is invisible: the rule
sits there looking active while matching nothing. Switching the resolver on
does not change what clients are told to use: that is the default DNS from
the general settings, shown in the DNS section next to a button that points it
at this server. The routing page also warns when a domain rule exists and
lookups are not arriving here.

Changing that setting affects newly downloaded client configurations. Devices
already set up keep their current resolver until their configuration is
downloaded again.

An address learned this way stays matchable for twice the record's own lifetime:
at least five minutes, at most a day. While traffic is still flowing to it, that
is extended further, so a long download or a call does not change route halfway
through.

Turning the resolver off releases port 53, and rules stop learning from client
lookups. Rules with **Keep addresses up to date** still resolve their domains on
a schedule, and rules written as plain addresses are unaffected either way.

## Port forwarding

A forward makes one of your clients reachable from outside.

Only ports the container publishes can be forwarded, so they have to be opened
in Docker and declared to wg-easy, and the two have to agree. A range is the
usual shape; single ports can be added next to it:

```yaml
services:
    wg-easy:
        environment:
            - ROUTER_FORWARD_PORTS=34000-34100, 25565
        ports:
            - '34000-34100:34000-34100/tcp'
            - '34000-34100:34000-34100/udp'
            - '25565:25565/tcp'
```

`ROUTER_FORWARD_PORT_START` and `ROUTER_FORWARD_PORT_END` describe a single
range the same way and still work; whatever is declared, in either form, is
what the routing page offers. With nothing declared at all, `34000-34100` is
assumed. A list that is set and empty (`ROUTER_FORWARD_PORTS=`) means the
container publishes no ports: the routing page says so and refuses new
forwards, rather than offering a range that goes nowhere, which is the right
setting for a compose file with the port lines removed.

Keep the list as narrow as you can. With Docker's userland proxy enabled, which
is the default, every published port runs its own helper process, so a wide
range costs memory whether the ports are used or not. Changing the list requires
recreating the container, and the server's own ports, the admin UI and the
WireGuard listener, can never be forwarded.

A forward whose port is no longer in the list, because the list was narrowed
after the forward was made, is kept but not installed: the routing page marks
it, and it comes back by itself once the port is published again.

Removing or disabling a forward, or pointing it at another client, ends the
connections it was carrying as well as stopping new ones. The kernel keeps
translating a connection it has already seen whatever the rules now say, so
without this a removed forward would keep working for as long as its session
lasted, hours for a game or SSH.

Only traffic arriving from outside is forwarded. Connections from clients, or
arriving through a gateway, are left alone. Forwards keep working regardless of
the default route: replies from the client are recognised and sent back the way
the request arrived, rather than out a gateway.

## Environment

| Env                         | Default       | Description                                                     |
| --------------------------- | ------------- | --------------------------------------------------------------- |
| `ROUTER_FORWARD_PORTS`      | `34000-34100` | Ports and ranges available to inbound forwards, comma-separated |
| `ROUTER_FORWARD_PORT_START` |               | First port of a range, the older way to declare one             |
| `ROUTER_FORWARD_PORT_END`   |               | Last port of that range                                         |

## Troubleshooting

The routing page reports two things at the top: whether the tools the router
needs were found, and whether the last apply succeeded. If either is red, the
kernel does not match what the page shows.

The container's default `DEBUG` already includes `Router`, which logs each apply
and each address learned. The individual `iptables`, `ip` and `ipset` commands
are printed by `CMD`, also on by default, so the container log shows exactly
what was run and what failed.

If the tools are reported missing, see the FAQ for the kernel modules involved:
`ip_set`, `ip_set_hash_net`, `xt_set`, `iptable_mangle` and, with IPv6,
`ip6table_mangle`.
