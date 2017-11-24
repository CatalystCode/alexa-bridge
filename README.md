# alexa-bridge

A bridge between Alexa Skills and the Microsoft Bot SDK

# Overview

This is a simple restify-based server that acts as a bridge between an Alexa Skill and a Microsoft Bot Framework bot. Utterances originating at an Alexa endpoint e.g. an Echo device are received by this bridge, translated and forwarded to the Microsoft Bot. Replies coming back from the Bot are then returned to the originating endpoint. Alexa will read out the text in the `Text` field of the Bot reply.

# HowTo

## Set up an Alexa Skill

First you'll need an [Alexa skill](https://developer.amazon.com). Set this up to be a Custom skill with whatever Invocation Name you prefer. 

Next, configure the interaction model exactly like this:
```json
{
  "intents": [
    {
      "slots": [
        {
          "name": "phrase",
          "type": "phrase"
        }
      ],
      "intent": "GetUserIntent"
    }
  ]
}
```

Next add a single custom slot type named 'phrase'. Value must be more than one word I used "this is a long sentence with multiple words"

Finally provide a single sample utterance:

```
GetUserIntent {phrase}
```

This ensures that everything the user says will be passed straight through to the Microsot Bot. We're not going to be using any of the intent or entity recognition features of Alexa.

For SSL certificate use:
My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority

## Set up the Microsoft Bot

Head on over to the [Microsoft Bot Framework](https://dev.botframework.com/) and create yourself a new bot (if you didn't already have one). Set up a DirectLine channel. This is how the bridge will talk to the Bot.

## Set up ngrok (for local dev/testing)

Get yourself [ngrok](https://ngrok.com). To test both the bridge and the bot on your local machine you'll need two ngrok instances running.

```
ngrok http 8080 <- The bridge
ngrok http 3979 <- The Bot
```

### Configure Alexa Skill

Take the public ngrok endpoint for the 8080 port and use it to configure an HTTP endpoint for the skill in the Alexa Skill configuration.

ngrok http -bind-tls=true -host-header=rewrite 8080

Use the https protocol and add `/messages`. Final url should look something like this: `https://<id>.ngrok.io/messages`.



### Configure Bot

Take the public endpoint for the 3979 (or whatever you choose) port and use as the messaging endpoint in the configration for the Micrsoft bot.

## Start the alexa-bridge

Now we can start the bridge, but let's do a quick bit of configuration first:

### Configuring the alexa-bridge

There are only two configuration settings:

* `botId` - The Bot identity in the conversation. This won't actually be seen anywhere at present.
* `directLineSecret` - The secret created when setting up the DirectLine channel for the Bot.

You can either put these in a file called .env
```

### Starting the alexa-bridge

```
@localhost:~/src/alexa-bridge$ node ./server.js
Starting...
restify listening at http://[::]:8080
```
At this point you should be able to use the test page on the Alexa Skill configuration to send utterances to the bridge. You'll get no replies of course but ngrok should show you connections are being made.

### Start the Bot

How you do this depends on whether you're in Node or C#, but I'm trusting you can figure this out.
