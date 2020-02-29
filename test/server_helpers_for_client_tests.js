'use strict'

var MqttServer = require('./server').MqttServer
var MqttServerNoWait = require('./server').MqttServerNoWait

/**
 * This will build the client for the server to use during testing, and set up the
 * server side client based on mqtt-connection for handling MQTT messages.
 * @param {boolean} fastFlag
 */
function serverBuilder (fastFlag) {
  var handler = function (client) {
    client.on('auth', function (packet) {
      var rc = 'reasonCode'
      var connack = {}
      connack[rc] = 0
      client.connack(connack)
    })
    client.on('connect', function (packet) {
      var rc = 'returnCode'
      var connack = {}
      if (client.options && client.options.protocolVersion === 5) {
        rc = 'reasonCode'
        if (packet.clientId === 'invalid') {
          connack[rc] = 128
        } else {
          connack[rc] = 0
        }
      } else {
        if (packet.clientId === 'invalid') {
          connack[rc] = 2
        } else {
          connack[rc] = 0
        }
      }
      if (packet.properties && packet.properties.authenticationMethod) {
        return false
      } else {
        client.connack(connack)
      }
    })

    client.on('publish', function (packet) {
      setImmediate(function () {
        switch (packet.qos) {
          case 0:
            break
          case 1:
            client.puback(packet)
            break
          case 2:
            client.pubrec(packet)
            break
        }
      })
    })

    client.on('pubrel', function (packet) {
      client.pubcomp(packet)
    })

    client.on('pubrec', function (packet) {
      client.pubrel(packet)
    })

    client.on('pubcomp', function () {
      // Nothing to be done
    })

    client.on('subscribe', function (packet) {
      client.suback({
        messageId: packet.messageId,
        granted: packet.subscriptions.map(function (e) {
          return e.qos
        })
      })
    })

    client.on('unsubscribe', function (packet) {
      packet.granted = packet.unsubscriptions.map(function () { return 0 })
      client.unsuback(packet)
    })

    client.on('pingreq', function () {
      client.pingresp()
    })

    client.on('end', function () {
      console.log('disconnected from server')
    })
  }
  if (fastFlag) {
    return new MqttServerNoWait(handler)
  } else {
    return new MqttServer(handler)
  }
}

exports.serverBuilder = serverBuilder
