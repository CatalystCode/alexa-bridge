"use strict";

var util = require('util');
var crypto = require('crypto');
var restify = require('restify');

var directLine = require('botframework-directlinejs');

// This loads the environment variables from the .env file - updated from .config for continuous deployment
require('dotenv-extended').load();

// connects to applicationinsights comment out the following three lines if you aren't using appinsights
let appInsights = require('applicationinsights');
appInsights.setup(process.env.APPINSIGHTS_INSTRUMENTATIONKEY).start(); // reads in from APPINSIGHTS_INSTRUMENTATIONKEY by default in the .env file
let client = appInsights.client;

// Required to make rxjs ajax run browser-less
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var config = {}
config.botId = process.env.botId
config.directLineSecret = process.env.directLineSecret

var timing = {};
var responses = {};
var botId = config.botId;

function sendReply(replyToId) {

  // Send our reply to Alexa

  var res_next = responses[replyToId];
  var res = res_next[0]; 
  var next = res_next[1];
  var reply = res_next[2];
  delete responses[replyToId];

  console.log("Replying: ");
  console.log(reply);
 
  if (res.send) {
    res.send(reply);
    next();
  }
  
  
}

function botSays(activity) {

  // This is where messages from the Bot come in.
  // They could be in response to system messages, unprompted
  // or replies to our own messages

  // We see *all* messages in the conversation, forcing us to screen out
  // the client-originated ones and forward just the bot's replies to previous requests
  
  console.log("Bot says: ");
  console.log(activity);

  if (activity.from.id == botId && activity.replyToId) {

    var reply = { 
      "version": "1.0",
      "response": {
        "outputSpeech": {
          "type": (activity.speak) ? "SSML" : "PlainText",
          "text": activity.text,
          "ssml": (activity.speak) ? ((activity.speak.lastIndexOf("<speak>", 0) === 0) ? activity.speak : "<speak>" + activity.speak + "</speak>" ) : null
        },
        "reprompt": {
          "outputSpeech": {
            "type": "PlainText",
            "text": process.env.promptPhrase || "Can I help you with anything else?"  // provides the prompt phrase if the user doesn't ask another question after the first answer is send to them
          }
        },
        "shouldEndSession" : ((activity.inputHint) && (activity.inputHint == 'expectingInput')) 
        ? false // Looks for inputHints on the incoming activity from the bot and checks for 'éxpectingInput', which will leave the session open.
        : ((process.env.leaveSessionOpen && process.env.leaveSessionOpen == 'true') ? false : true)   // If no inputHint is found then check if the 'leaveSessionOpen' app setting exists and is set to 'true' - if it is leave the session open, otherwise close the session by default
      }
    };

    if(process.env.useHeroCardAttachmentAsAlexaCard 
      && process.env.useHeroCardAttachmentAsAlexaCard == 'true' 
      && activity.attachments && activity.attachments[0] 
      && activity.attachments[0].contentType == "application/vnd.microsoft.card.hero")
    {
      var card = { 
        "type": "Standard",
        "title": activity.attachments[0].content.title,
        "text": activity.attachments[0].content.text,
        "image": {
          "smallImageUrl": activity.attachments[0].content.images[0].url,
          "largeImageUrl": activity.attachments[0].content.images[0].url
          }
      };
      
      reply.response.card = card;
    }

    if (activity.replyToId in responses) {
      console.log("SEND IMMEDIATELY");
      // We've matched the conversation id so we can send back the conversation to Alexa immediately.
      responses[activity.replyToId].push(reply);
      sendReply(activity.replyToId);
    }
    else {
      console.log("SEND DEFERRED");
      // We haven't seen the reply to our initial send yet so we
      // don't know to which response object we need to send this 
      // reply, store until we can match to a conversation coming back from the bot framework

      if (activity.replyToId.indexOf('|')>0) {
        // greeting messages from the bot framework don't have a pipe in their conversation ID
        // don't store greeting messages.
        responses[activity.replyToId] = [reply];
      }
    }
  }
}

function alexaIntent(req, res, bot, next) {

  var userId = req.body.session.user.userId;
  var utterance = req.body.request.intent.slots.phrase.value;

  // Bot SDK seems to have some hidden rules regarding valid userId
  // so doing this works around those (else we get 400's)
  userId = crypto.createHmac('md5', userId).digest('hex');

  let startTime = Date.now();

  var channelData = {
    session_sessionId : (req.body.session.sessionId) ? req.body.session.sessionId : null,
    user_userId : (req.body.session.user.userId) ? req.body.session.user.userId : null,
    user_accessToken : (req.body.session.user.accessToken) ? req.body.session.user.accessToken : null,
    user_permissions : (req.body.session.user.permissions) ? req.body.session.user.permissions : null,
    alexa_apiAccessToken : (req.body.context.System.apiAccessToken) ? req.body.context.System.apiAccessToken : null,
    alexa_apiEndpoint :  (req.body.context.System.apiEndpoint) ? req.body.context.System.apiEndpoint : null,
    device : (req.body.context.System.device) ? req.body.context.System.device : null
  };

  var activity = {
    type : "message",
    text : utterance,
    from : { id : userId },
    locale : process.env.msglocale || "en-US",
    timestamp : (new Date()).toISOString(),
    channelData : channelData
  };

  // Forward the activity to our Bot
  bot.postActivity(activity)
  .subscribe(id => {
    if (id != 'retry') {

      if (client) {
        let duration = Date.now() - startTime;
        client.trackMetric({name: "connector response time", value: duration});
      }

      // id is the replyToId for the message, we're going to
      // use this match up replies (what the bot says to us) to
      // repsonse objects (the http transport back to Alexa)

      if (id in responses) {
        // We've already had the reply from the Bot, send straight away
        responses[id].unshift(next);
        responses[id].unshift(res);
        sendReply(id);
      }
      else {
        // Bot hasn't replied yet, store the response objects until it has
        responses[id] = [res, next];
      }
    }
  }, error => {
    console.warn("failed to send postBack", error);
  });
}

function alexaSays(req, res, bot, next) {
  
  // Alexa is calling us with the utterance
  console.log("Alexa says:");
  console.log(util.inspect(req.body, false, null));

  if (req.body && req.body.request && req.body.request.type && 
      req.body.request.type == "IntentRequest") {
    alexaIntent(req, res, bot, next);
  }
  else if (req.body && req.body.request && req.body.request.type && 
    req.body.request.type == "SessionEndedRequest") {
      // the session has likely timed out from Alexa as no response was received after the prompt.
      var reply = { 
        "version": "1.0",
        "response": {
          "outputSpeech": {
            "type": "PlainText",
            "text": ""
          },
          "shouldEndSession" : true  // close the bridge to avoid the "there was a problem with the requested skills response" message from being played after timeout
        }
      };

      console.log("closing the session");
      res.send(reply);
      next();
      
  }
  else {
    return next(new restify.InvalidArgumentError("Unhandled request type"));
  } 
}

function startBridge() {

 

  var opts = { secret : config.directLineSecret, webSocket:false };
  var connector = new directLine.DirectLine(opts);
 
  connector.activity$.subscribe(
    botSays,
    error => console.log("activity$ error", error)
  );

  var server = restify.createServer();
  server.use(restify.bodyParser());
  server.post('/messages', (req, res, err) => alexaSays(req, res, connector, err) );

  server.listen(process.env.port || process.env.PORT || 8080, function() {
    console.log('%s listening at %s', server.name, server.url);
  });

  return server;
}

module.exports = {
  start : startBridge
};


