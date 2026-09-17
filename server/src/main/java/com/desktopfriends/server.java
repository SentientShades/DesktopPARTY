package com.desktopfriends;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.javalin.Javalin;
import io.javalin.websocket.WsContext;

import java.time.Duration;
import java.util.Deque;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

public class server {

    private static final int MAX_PARTY = 8;
    private static final int MAX_QUEUED = 50;

    // one shared party: everyone who connects auto-joins, same as the local host server
    private static final Set<String> members = ConcurrentHashMap.newKeySet();
    private static final Map<String, WsContext> clients = new ConcurrentHashMap<>();
    private static final Map<String, WsContext> signalClients = new ConcurrentHashMap<>();
    private static final Map<String, Deque<String>> queued = new ConcurrentHashMap<>();

    private static final ObjectMapper json = new ObjectMapper();

    public static void main(String[] args) {
        Javalin.create(config -> {

            config.jetty.modifyWebSocketServletFactory(factory ->
                factory.setIdleTimeout(Duration.ofMinutes(10))
            );

            config.routes.ws("/presence", ws -> {

                ws.onConnect(ctx -> {
                    String userId = ctx.queryParam("userId");
                    if (userId == null || userId.isBlank()) {
                        ctx.closeSession(1008, "missing userId");
                        return;
                    }
                    ctx.attribute("userId", userId);
                    clients.put(userId, ctx);
                    join(userId);
                    System.out.println("presence connect: " + userId + " (" + clients.size() + " online)");
                });

                ws.onMessage(ctx -> {
                    String userId = ctx.attribute("userId");
                    try {
                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());
                        if ("party:leave".equals(msg.path("type").asText())) leave(userId);
                    } catch (Exception e) {
                        System.out.println("bad presence msg from " + userId + ": " + e.getMessage());
                    }
                });

                ws.onClose(ctx -> {
                    String userId = ctx.attribute("userId");
                    if (userId != null && clients.get(userId) == ctx) {
                        clients.remove(userId);
                        leave(userId);
                        System.out.println("presence close: " + userId);
                    }
                });

                ws.onError(ctx -> System.out.println("presence error: " + ctx.error()));
            });

            config.routes.ws("/signal", ws -> {

                ws.onConnect(ctx -> {
                    String userId = ctx.queryParam("userId");
                    if (userId == null || userId.isBlank()) {
                        ctx.closeSession(1008, "missing userId");
                        return;
                    }
                    ctx.attribute("userId", userId);
                    signalClients.put(userId, ctx);
                    System.out.println("signal connect: " + userId);

                    Deque<String> held = queued.remove(userId);
                    if (held != null) {
                        System.out.println("flushing " + held.size() + " queued signal(s) to " + userId);
                        held.forEach(ctx::send);
                    }
                });

                ws.onMessage(ctx -> {
                    String from = ctx.attribute("userId");
                    try {
                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());
                        String to = msg.path("to").asText(null);
                        if (to == null) return;

                        msg.put("from", from);
                        String type = msg.path("type").asText("?");
                        String payload = msg.toString();
                        WsContext target = signalClients.get(to);

                        if (target != null) {
                            System.out.println("signal " + type + ": " + from + " -> " + to + "  OK");
                            target.send(payload);
                        } else {
                            System.out.println("signal " + type + ": " + from + " -> " + to + "  QUEUED");
                            Deque<String> q = queued.computeIfAbsent(to, k -> new ConcurrentLinkedDeque<>());
                            q.addLast(payload);
                            while (q.size() > MAX_QUEUED) q.pollFirst();
                        }
                    } catch (Exception e) {
                        System.out.println("bad signal from " + from + ": " + e.getMessage());
                    }
                });

                ws.onClose(ctx -> {
                    String userId = ctx.attribute("userId");
                    if (userId != null && signalClients.get(userId) == ctx) {
                        signalClients.remove(userId);
                        System.out.println("signal close: " + userId);
                    }
                });

                ws.onError(ctx -> System.out.println("signal error: " + ctx.error()));
            });

        }).start(8080);

        System.out.println("presence + signal server listening on 8080");
    }

    private static void join(String userId) {
        if (members.size() >= MAX_PARTY) {
            sendTo(userId, error("Party is full (" + MAX_PARTY + " max)"));
            return;
        }
        members.add(userId);
        System.out.println("joined: " + userId + " (" + members.size() + "/" + MAX_PARTY + ")");
        broadcastRoster();
    }

    private static void leave(String userId) {
        if (!members.remove(userId)) return;
        System.out.println("left: " + userId);
        broadcastRoster();

        // always tell the leaver they personally have no party, even if others remain
        ObjectNode empty = json.createObjectNode();
        empty.put("type", "party:roster");
        empty.putNull("partyId");
        empty.putArray("members");
        sendTo(userId, empty);
    }

    private static void broadcastRoster() {
        String payload = roster().toString();
        members.forEach(id -> {
            WsContext ctx = clients.get(id);
            if (ctx != null) ctx.send(payload);
        });
    }

    private static ObjectNode roster() {
        ObjectNode out = json.createObjectNode();
        out.put("type", "party:roster");
        out.put("partyId", members.isEmpty() ? null : "party");
        ArrayNode arr = out.putArray("members");
        members.stream().sorted().forEach(arr::add);
        return out;
    }

    private static ObjectNode error(String text) {
        ObjectNode out = json.createObjectNode();
        out.put("type", "error");
        out.put("message", text);
        return out;
    }

    private static void sendTo(String userId, ObjectNode msg) {
        WsContext ctx = clients.get(userId);
        if (ctx != null) ctx.send(msg.toString());
    }
}
