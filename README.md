# alexa-bridge

A bridge between Alexa Skills and the Azure Bot Service

<a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fdaltskin%2Falexa-bridge%2Fmaster%2Fdeploy%2Fazuredeploy.json" target="_blank">
    <img src="http://azuredeploy.net/deploybutton.png"/>
</a>

# Overview

This is a simple restify-based server that acts as a bridge between an Alexa Skill and the Azure Bot Service. Utterances originating at an Alexa endpoint e.g. an Echo device are received by this bridge, translated and forwarded to the Microsoft Bot Framework. Replies coming back from the Bot are then returned to the originating endpoint. Alexa will read out the text in the `Text` field of the Bot reply.

# HowTo

## Set up the Microsoft Bot

Head on over to the [Microsoft Bot Framework](https://dev.botframework.com/) and create yourself a new bot (if you didn't already have one). Set up the [DirectLine](https://docs.microsoft.com/en-us/azure/bot-service/bot-service-channel-connect-directline) channel and make a note of the DirectLine secret. This is how the bridge will talk to the Bot.

> ### Development: Set up ngrok (for local dev/testing only)
> Get yourself [ngrok](https://ngrok.com). To test both the bridge and the bot on your local machine you'll need two ngrok instances running.
>```
>ngrok http 8080 <- The bridge
>ngrok http 3979 <- The Bot
>```
>
## Set up an Alexa Skill

First you'll need an [Alexa skill](https://developer.amazon.com). Set this up to be a Custom skill with whatever `Skill Invocation Name` you prefer. 

### Interaction Model
Use the JSON Editor to configure the interaction model exactly like this [sample provided in this repo](.\assets\alexa_model_example.json)
```json
{
    "interactionModel": {
        "languageModel": {
            "invocationName": "<replace this>",
            "intents": [
                {
                    "name": "AMAZON.CancelIntent",
                    "samples": []
                },
                {
                    "name": "AMAZON.HelpIntent",
                    "samples": []
                },
                {
                    "name": "AMAZON.StopIntent",
                    "samples": []
                },
                {
                    "name": "GetUserIntent",
                    "slots": [
                        {
                            "name": "phrase",
                            "type": "phrase"
                        }
                    ],
                    "samples": [
                        "{phrase}"
                    ]
                }
            ],
            "types": [
                {
                    "name": "phrase",
                    "values": [
                        {
                            "name": {
                                "value": "GetUserIntent asdf {phrase}"
                            }
                        }
                    ]
                }
            ]
        }
    }
}
```

This ensures that everything the user says will be passed straight through to the Microsot Bot.  We're not going to be using any of the intent or entity recognition features of Alexa instead we are using Alexa as a glorified microphone and speaker that performs the voice to text component for us.

### Endpoint Configuration
Configure the Service Endpoint Type as follows

| Endpoint Type | Default Region | SSL Certificate type |
| ----- | ----- | ----- |
| `HTTPS` | `https://<your-appname>.azurewebsites.net/messages` | `My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority` |

> ### Development note for local dev/test
> 
> Take the public ngrok endpoint for the 8080 port and use it to configure an HTTP endpoint for the skill in the Alexa Skill configuration.

> ```
> ngrok http -bind-tls=true -host-header=rewrite 8080
> ```

> Default Region will be `https://<id>.ngrok.io/messages`


### Test

To test the solution type a phrase into the Service Simulator - Enter Utterance text field - this should invoke your application below as long as the alexa-bridge is running.

### Configure Bot

Take the public endpoint for the 3979 (or whatever you choose) port and use as the messaging endpoint in the configration for the Microsoft bot.

## Start the alexa-bridge

The easiest way to deploy this is to use the `Deploy to Azure` button above, all the following settings will automatically be setup for you.  Recommend that you deploy this to the same data center to where you Azure Bot Service is reduce latency between the Alexa <> Bridge <> Bot.
The bridge will automatically start after deployment so should be good to go.

### Configuring the alexa-bridge

The following application keys are required, you can set these in your launch.json file for development or in the Application Settings within the Azure portal.  

| Key | Value | Description |
| ----- | ----- | ----- |
|`botId` | `<yourbotname>` | The Bot identity in the conversation. This won't actually be seen anywhere|
|`directLineSecret` | `<yourbotsecret>` | The secret created when setting up the DirectLine channel for the Bot |
|`promptPhrase` | `Can I help you with anything else?` | This is the phrase used to prompt the user to continue the conversation
|`msglocale` | `en-US` | The locale for the message language
|`APPINSIGHTS_INSTRUMENTATIONKEY` | `<yourappinsightsguid>` | The instrumentation key for appinsignts - comment out the appinsights code if you aren't using it  https://docs.microsoft.com/en-us/azure/application-insights/app-insights-nodejs-quick-start |
|`leaveSessionOpen` | `false` | Set this to "false" to end the session by default (i.e. Alexa does not wait for further input) or "true" to wait for input and use the promptPhrase to prompt the user if they do not say anything else |
| `useHeroCardAttachmentAsAlexaCard` | `false` | Set this to "true" to have the bridge use a Bot Framework Hero Card attachment to construct an Alexa card (the title, text and image from the Hero Card to populate the Alexa card). By default this is disabled unless this variable exists and is set to "true" |
|`progressiveResponse` | `Working in it` | The busy message that you want Alexa to say whilst results are being retrieved from your bot |
|`useMultipleResponses` | `true` | Set this to true if your bot responds with more than 1 message in any response |
|`multipleResponsesTimeout` | `3000` | Time in milliseconds that any buffered responses from your bot will be released to Alexa.  If you have long running tasks, set this value slightly longer than they take.  However, careful setting this value to large (4+ milliseconds) as your bot responses will be ignored and you'll g et the standard Alexa timeout response instead |
|`useWebsocket` | `true` | Use websockets vs polling DirectLine connector service |
|`directLineDomain` | `https://directline.botframework.com/v3/directline` |You can tweak this setting depending on your geographic region - the default should be fine. Possible options are: https://directline.botframework.com/v3/directline  https://asia.directline.botframework.com/v3/directline * https://europe.directline.botframework.com/v3/directline * https://northamerica.directline.botframework.com/v3/directline |

### Starting the alexa-bridge

If you are using VS Code open the folder where you cloned this repo and navigate to the View-ntegrated Terminal and run 
```
npm install --save
```
Next navigate to the server.js file and Debug - Start Debugging (F5)

Alternatively run

```
@localhost:~/src/alexa-bridge$ node ./server.js
Starting...
restify listening at http://[::]:8080
```
At this point you should be able to use the test page on the Alexa Skill configuration to send utterances to the bridge. You'll get no replies unless you are connected to a published bot but ngrok should show you connections are being made.

### Start the Bot

How you do this depends on whether you're in Node or C#, but I'm trusting you can figure this out.

### Channel Data

By default the ChannelData property on the Acitivity object sent to your bot is populated with the following properties;

* Alexa Session Id (session_sessionId)
* Alexa User Id (user_userId)
* Linked Account Access Token (user_accessToken - if account linking is enabled for the skill and the user has successfully linked their account)
* User Permissions (user_permissions)
* Alexa Api Access Token (alexa_apiAccessToken)
* Alexa Api Endpoint (alexa_apiEndpoint)
* Device (device)

The above properties will allow you to do things like check the type of Alexa device being used, the permissions that the user has accepted (such as allowing you to see their full or partial address), or send progressive messages / notifications using Alexa Apis (via the Alexa Api Access Token and Endpoint).

### Managing conversation via Bot

The Bot Framework SDK allows you to either send text based messages, or alternatively (when using channels like Cortana) to send SSML for more granular control over how something is spoken.  This bridge now supports both, using the 'text' property on the activity by default, but allowing this to be overridden by the 'speak' property if SSML has been specified.

The bridge will also look for inputHints on the incoming activity from the bot, specifically looking for the 'expectingInput' hint, which will cause the bridge to leave the conversation open and allow the user to say something else without explicitly invoking the skill again.

Below is an example of using the above features in a C# bot. In this example we send some basic SSML from the bot to the bridge and also indicate that we are expecting an answer from the user.

```
var messageText = "What would you like to do next?";
var speakText = "<speak>Thanks! I say, What would you like to do next?</speak>";
var messageOptions = new MessageOptions
            {
                InputHint = InputHints.ExpectingInput
            };
await context.SayAsync(messageText, speakText, options: messageOptions);
```

There is also an app setting 'leaveSessionOpen' which, if set to "true", will leave the session open and accept more input by default without needing to specify it explicitly using the inputHint.  However, having this set to false will allow you to only wait for more input from the user when it makes sense for your bot.

### Publishing this project to an Azure App Service

There are a few different ways to deploy this to Azure - including the provided arm template

[Publish using Azure Resoure Manager template](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fdaltskin%2Falexa-bridge%2Fmaster%2Fdeploy%2Fazuredeploy.json)
Deploys straight into a Resource Group, just provide the Application Settings during provisioning and you're good to go.


[Publish using Azure CLI](https://docs.microsoft.com/en-us/azure/app-service/app-service-web-get-started-nodejs)
Alternatively you can do this using the Azure portal. One thing I did find is that you may need to use the B1 Basic or above for the app service plan and host it in the same location as the Alexa skill and the bot to reduce latency. Free or shared app services don't support always on which means there is a long startup time for the bot/bridge which can lead to timeouts as Alexa will only wait 8 seconds for a response before timing out.

[Watch](https://azure.microsoft.com/en-us/resources/videos/create-a-nodejs-site-deploy-from-github/) or [Read](https://docs.microsoft.com/en-us/bot-framework/deploy-bot-github) more on deploying node.js websites to azure.

The key thing is that once the app is deployed to the app service you need to go to application settings and load the values from the .env file into the app settings panel.

You may also need to regenerate the npm packages on the server using [Kudu](https://github.com/projectkudu/kudu/) navigate to https://*****.scm.azurewebsites.net (where ***** is the name of your Web App) and running npm install against the Debug console / CMD / site / wwwroot directory. 