package com.desktopfriends;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.javalin.Javalin;
import io.javalin.websocket.WsContext;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class server {

    private static final int MAX_PARTY = 8;

    private static final Map<String, WsContext> clients = new ConcurrentHashMap<>();
    private static final Map<String, WsContext> signalClients = new ConcurrentHashMap<>();
    private static final Map<String, Set<String>> parties = new ConcurrentHashMap<>();
    private static final Map<String, String> userParty = new ConcurrentHashMap<>();

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
                    System.out.println("presence connect: " + userId + " (" + clients.size() + " online)");
                    broadcastPresence(userId, "online", null);
                    broadcastOnlineList();
                });

                ws.onMessage(ctx -> {
                    String userId = ctx.attribute("userId");
                    try {
                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());
                        String type = msg.path("type").asText();

                        switch (type) {
                            case "presence" -> broadcastPresence(userId,
                                    msg.path("status").asText("online"),
                                    msg.path("activity").asText(null));
                            case "party:create" -> createParty(userId);
                            case "party:invite" -> inviteToParty(userId, msg.path("to").asText(null));
                            case "party:join"   -> joinParty(userId, msg.path("partyId").asText(null));
                            case "party:leave"  -> leaveParty(userId);
                            default -> System.out.println("unknown msg type: " + type);
                        }
                    } catch (Exception e) {
                        System.out.println("bad presence msg from " + userId + ": " + e.getMessage());
                    }
                });

                ws.onClose(ctx -> {
                    String userId = ctx.attribute("userId");
                    if (userId != null && clients.get(userId) == ctx) {
                        clients.remove(userId);
                        leaveParty(userId);
                        System.out.println("presence close: " + userId);
                        broadcastPresence(userId, "offline", null);
                        broadcastOnlineList();
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
                    System.out.println("signal connect: " + userId + "  " + signalClients.keySet());
                });

                ws.onMessage(ctx -> {
                    String from = ctx.attribute("userId");
                    try {
                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());
                        String to = msg.path("to").asText(null);
                        if (to == null) return;

                        msg.put("from", from);
                        WsContext target = signalClients.get(to);
                        System.out.println("signal " + msg.path("type").asText("?")
                                           + ": " + from + " -> " + to
                                           + (target != null ? "  OK" : "  TARGET OFFLINE"));
                        if (target != null) target.send(msg.toString());
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

        System.out.println("presence + signal + party server listening on 8080");
    }

    private static void createParty(String userId) {
        leaveParty(userId);
        String partyId = UUID.randomUUID().toString().substring(0, 8);
        Set<String> members = ConcurrentHashMap.newKeySet();
        members.add(userId);
        parties.put(partyId, members);
        userParty.put(userId, partyId);
        System.out.println("party created: " + partyId + " by " + userId);
        broadcastRoster(partyId);
    }

    private static void inviteToParty(String from, String to) {
        if (to == null) return;

        String partyId = userParty.get(from);
        if (partyId == null) {
            createParty(from);
            partyId = userParty.get(from);
        }

        Set<String> members = parties.get(partyId);
        if (members == null) return;

        if (members.size() >= MAX_PARTY) {
            sendTo(from, error("Party is full (" + MAX_PARTY + " max)"));
            return;
        }

        WsContext target = clients.get(to);
        if (target == null) {
            sendTo(from, error(to + " is not online"));
            return;
        }

        ObjectNode invite = json.createObjectNode();
        invite.put("type", "party:invited");
        invite.put("partyId", partyId);
        invite.put("from", from);
        target.send(invite.toString());
        System.out.println("party invite: " + from + " -> " + to);
    }

    private static void joinParty(String userId, String partyId) {
        if (partyId == null) return;

        Set<String> members = parties.get(partyId);
        if (members == null) {
            sendTo(userId, error("That party no longer exists"));
            return;
        }
        if (members.size() >= MAX_PARTY) {
            sendTo(userId, error("Party is full (" + MAX_PARTY + " max)"));
            return;
        }

        leaveParty(userId);
        members.add(userId);
        userParty.put(userId, partyId);
        System.out.println("party join: " + userId + " -> " + partyId
                           + " (" + members.size() + "/" + MAX_PARTY + ")");
        broadcastRoster(partyId);
    }

    private static void leaveParty(String userId) {
        String partyId = userParty.remove(userId);
        if (partyId == null) return;

        Set<String> members = parties.get(partyId);
        if (members != null) {
            members.remove(userId);
            System.out.println("party leave: " + userId + " from " + partyId);
            if (members.isEmpty()) {
                parties.remove(partyId);
                System.out.println("party disbanded: " + partyId);
            } else {
                broadcastRoster(partyId);
            }
        }
        sendTo(userId, rosterNode(null, Set.of()));
    }

    private static void broadcastRoster(String partyId) {
        Set<String> members = parties.get(partyId);
        if (members == null) return;
        String payload = rosterNode(partyId, members).toString();
        for (String id : members) {
            WsContext ctx = clients.get(id);
            if (ctx != null) ctx.send(payload);
        }
    }

    private static ObjectNode rosterNode(String partyId, Set<String> members) {
        ObjectNode out = json.createObjectNode();
        out.put("type", "party:roster");
        out.put("partyId", partyId);
        ArrayNode arr = out.putArray("members");
        members.stream().sorted().forEach(arr::add);
        return out;
    }

    private static void broadcastPresence(String userId, String status, String activity) {
        ObjectNode out = json.createObjectNode();
        out.put("type", "friend_update");
        out.put("userId", userId);
        out.put("status", status);
        out.put("activity", activity);

        String payload = out.toString();
        clients.forEach((id, ctx) -> {
            if (id.equals(userId)) return;
            try { ctx.send(payload); }
            catch (Exception e) { clients.remove(id); }
        });
    }

    private static void broadcastOnlineList() {
        ObjectNode out = json.createObjectNode();
        out.put("type", "online_list");
        ArrayNode arr = out.putArray("users");
        clients.keySet().stream().sorted().forEach(arr::add);

        String payload = out.toString();
        clients.forEach((id, ctx) -> {
            try { ctx.send(payload); }
            catch (Exception e) { clients.remove(id); }
        });
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