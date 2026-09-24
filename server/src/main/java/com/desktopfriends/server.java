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
    private static final int maxparty = 8; // party cap

    private static final int maxqueued = 50;
    private static final Set<String> members = ConcurrentHashMap.newKeySet();


    private static final Map<String, WsContext> clients = new ConcurrentHashMap<>();
    private static final Map<String, WsContext> signals = new ConcurrentHashMap<>();

    private static final Map<String, Deque<String>> queued = new ConcurrentHashMap<>(); /// held signals
    private static final ObjectMapper json = new ObjectMapper();


    public static void main(String[] args) {
        Javalin.create(config -> {

            config.jetty.modifyWebSocketServletFactory(factory -> // idle timeout
                factory.setIdleTimeout(Duration.ofMinutes(10))
            );
            config.routes.ws("/presence", ws -> { ///// presence socket
                ws.onConnect(ctx -> {
                    String userid = ctx.queryParam("userId");
                    if (userid == null || userid.isBlank()) {

                        ctx.closeSession(1008, "missing userId"); // missing id
                        return;
                    }
                    ctx.attribute("userid", userid);


                    clients.put(userid, ctx);
                    join(userid);
                    System.out.println("presence connect: " + userid + " (" + clients.size() + " online)");
                });
                ws.onMessage(ctx -> {

                    String userid = ctx.attribute("userid");
                    try {
                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());

                        if ("party:leave".equals(msg.path("type").asText())) leave(userid);
                    } catch (Exception e) {
                        System.out.println("bad presence msg from " + userid + ": " + e.getMessage());

                    }
                });

                ws.onClose(ctx -> {
                    String userid = ctx.attribute("userid");
                    if (userid != null && clients.get(userid) == ctx) { //// stale check!!!
                        clients.remove(userid);

                        leave(userid);



                        System.out.println("presence close: " + userid);
                    }

                });
                ws.onError(ctx -> System.out.println("presence error: " + ctx.error()));
            });



            config.routes.ws("/signal", ws -> { // signal socket

                ws.onConnect(ctx -> {
                    String userid = ctx.queryParam("userId");

                    if (userid == null || userid.isBlank()) {
                        ctx.closeSession(1008, "missing userId");
                        return;

                    }
                    ctx.attribute("userid", userid);
                    signals.put(userid, ctx);
                    System.out.println("signal connect: " + userid);

                    /// flush queue
                    Deque<String> held = queued.remove(userid);
                    if (held != null) {
                        System.out.println("flushing " + held.size() + " queued signal(s) to " + userid);



                        held.forEach(ctx::send);
                    }
                });


                ws.onMessage(ctx -> {
                    String from = ctx.attribute("userid");
                    try {

                        ObjectNode msg = (ObjectNode) json.readTree(ctx.message());
                        String to = msg.path("to").asText(null);
                        if (to == null) return;
                        msg.put("from", from); // stamp sender

                        String type = msg.path("type").asText("?");
                        String payload = msg.toString();

                        WsContext target = signals.get(to);
                        if (target != null) {
                            System.out.println("signal " + type + ": " + from + " -> " + to + "  OK");

                            target.send(payload);
                        } else { /// offline peer

                            System.out.println("signal " + type + ": " + from + " -> " + to + "  QUEUED");
                            Deque<String> q = queued.computeIfAbsent(to, k -> new ConcurrentLinkedDeque<>());


                            q.addLast(payload);
                            while (q.size() > maxqueued) q.pollFirst(); //// cap queue!!
                        }
                    } catch (Exception e) {

                        System.out.println("bad signal from " + from + ": " + e.getMessage());
                    }

                });
                ws.onClose(ctx -> {
                    String userid = ctx.attribute("userid");

                    if (userid != null && signals.get(userid) == ctx) {
                        signals.remove(userid);
                        System.out.println("signal close: " + userid);

                    }
                });

                ws.onError(ctx -> System.out.println("signal error: " + ctx.error()));

            });
        }).start(8080);

        System.out.println("presence + signal server listening on 8080");

    }




    private static void join(String userid) {
        if (members.size() >= maxparty) { // full party

            send(userid, error("Party is full (" + maxparty + " max)"));
            return;
        }
        members.add(userid);

        System.out.println("joined: " + userid + " (" + members.size() + "/" + maxparty + ")");
        broadcast();
    }


    private static void leave(String userid) {

        if (!members.remove(userid)) return;
        System.out.println("left: " + userid);
        broadcast();




        /// clear leaver
        ObjectNode empty = json.createObjectNode();
        empty.put("type", "party:roster");

        empty.putNull("partyId");
        empty.putArray("members");
        send(userid, empty);

    }

    private static void broadcast() {
        String payload = roster().toString();

        members.forEach(id -> { // notify all
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




    private static void send(String userid, ObjectNode msg) {
        WsContext ctx = clients.get(userid);

        if (ctx != null) ctx.send(msg.toString());

    }
}