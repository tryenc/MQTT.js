'use strict'

var MqttServer = require('../server').MqttServer

console.log('here i am')
new MqttServer(function (client) {
  console.log('creating mqttserver')
  client.on('connect', function () {
    console.log('connack received')
    client.connack({ returnCode: 0 })
  })
}).listen(3000, 'localhost')
