"use strict";

var nconf = require('nconf');
var crypto = require('crypto');
var restify = require('restify');
var directLine = require('botframework-directlinejs');

// Required to make rxjs ajax run browser-less
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var config = nconf.argv().env().file({ file: 'localConfig.private.json' });

var timing = {};
var responses = {};
var botId = config.get('botId');

function sendReply(replyToId) {

  // Send our reply to Alexa

  var res_next = responses[replyToId];
  var res = res_next[0]; 
  var next = res_next[1];
  var reply = res_next[2];
  delete responses[replyToId];

  res.send(reply);
  next();
}

function botSays(activity) {

  // This is where messages from the Bot come in.
  // They could be in response to system messages, unprompted
  // or replies to our own messages

  // We see *all* messages in the conversation, forcing us to screen out
  // the client-originated ones and forward just the bot's 
  // replies to previous requests
  
  if (activity.from.id == botId && activity.replyToId) {

    console.log("Go reply");

    var reply = { 
      "version": "1.0",
      "response": {
        "outputSpeech": {
          "type": "PlainText",
          "text": activity.text
        }
      }
    }

    if (activity.replyToId in responses) {
      // We've already seen the reply to our initial send
      // so we can send straight away
      responses[activity.replyToId].push(reply);
      sendReply(activity.replyToId);
    }
    else {
      // We haven't seen the reply to our initial send yet so we
      // don't know to which response object we need to send this 
      // reply, store until we do
      responses[activity.replyToId] = [reply];
    }
  }
}

function alexaIntent(req, res, bot, next) {

  var userId = req.body.session.user.userId;
  var utterance = req.body.request.intent.slots.phrase.value;

  // Bot SDK seems to have some hidden rules regarding valid userId
  // so doing this works around those (else we get 400's)
  userId = crypto.createHmac('md5', userId).digest('hex');

  var startTime = new Date();

  var activity = {
    type : "message",
    text : utterance,
    from : { id : userId },
    locale : "en-US",
    timestamp : (new Date()).toISOString()
  };

  // Forward the activity to our Bot
  bot.postActivity(activity)
  .subscribe(id => {
    if (id != 'retry') {

      var endTime = new Date();
      console.log("Time: " + (endTime - startTime));

      // id is the replyToId for the message, we're going to
      // use this match up replies (what the bot says to us) to
      // repsonse objects (the http transport back to Alexa)

      if (id in responses) {
        // We've already had the reply from the Bot, send
        // straight away
        responses[id].unshift(next);
        responses[id].unshift(res);
        sendReply(id);
      }
      else {
        // Bot hasn't replied yet, store the response objects until
        // it has
        responses[id] = [res, next];
      }
    }
  }, error => {
    console.warn("failed to send postBack", error);
  });
}

function alexaSays(req, res, bot, next) {
  
  // Alexa is calling us with the utterance

  if (req.body && req.body.request && req.body.request.type && 
      req.body.request.type == "IntentRequest") {
    alexaIntent(req, res, bot, next);
  }
  else {
    return next(new restify.InvalidArgumentError("Unhandled request type"));
  } 
}

function startBridge() {
  
  var opts = { secret : config.get('directLineSecret'), webSocket:false };
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
}

function main() {
  console.log('Starting...');
  startBridge();
}

main();
