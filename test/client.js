'use strict'

var mqtt = require('..')
var assert = require('chai').assert
const { fork } = require('child_process')
var path = require('path')
var abstractClientTests = require('./abstract_client')
var net = require('net')
var eos = require('end-of-stream')
var mqttPacket = require('mqtt-packet')
var Buffer = require('safe-buffer').Buffer
var Duplex = require('readable-stream').Duplex
var Connection = require('mqtt-connection')
var MqttServer = require('./server').MqttServer
var util = require('util')
var ports = require('./helpers/port_list')
var serverBuilder = require('./server_helpers_for_client_tests').serverBuilder

describe('MqttClient', function () {
  var client
  var server = serverBuilder()
  var config = {protocol: 'mqtt', port: ports.PORT}

  server.listen(ports.PORT)

  afterEach(done => {
    if (client) {
      client.close()
    }
    done()
  })
  after(() => {
    // clean up and make sure the server is no longer listening...
    if (server.listening) {
      server.close()
    }
  })

  abstractClientTests(server, config)

  describe('creating', function () {
    it('should allow instantiation of MqttClient without the \'new\' operator', function (done) {
      assert.doesNotThrow(function () {
        try {
          client = mqtt.MqttClient(function () {
            throw Error('break')
          }, {})
          client.end()
        } catch (err) {
          assert.strictEqual(err.message('break'))
          done()
        }
      }, 'Object #<Object> has no method \'_setupStream\'')
    })
  })

  describe('message ids', function () {
    it('should increment the message id', function () {
      client = mqtt.connect(config)
      var currentId = client._nextId()

      assert.equal(client._nextId(), currentId + 1)
      client.end()
    })

    it('should return 1 once the internal counter reached limit', function () {
      client = mqtt.connect(config)
      client.nextId = 65535

      assert.equal(client._nextId(), 65535)
      assert.equal(client._nextId(), 1)
      client.end()
    })

    it('should return 65535 for last message id once the internal counter reached limit', function () {
      client = mqtt.connect(config)
      client.nextId = 65535

      assert.equal(client._nextId(), 65535)
      assert.equal(client.getLastMessageId(), 65535)
      assert.equal(client._nextId(), 1)
      assert.equal(client.getLastMessageId(), 1)
      client.end()
    })

    it('should not throw an error if packet\'s messageId is not found when receiving a pubrel packet', function (done) {
      var server2 = new MqttServer(function (serverClient) {
        serverClient.on('connect', function (packet) {
          serverClient.connack({returnCode: 0})
          serverClient.pubrel({ messageId: Math.floor(Math.random() * 9000) + 1000 })
        })
      })

      server2.listen(ports.PORTAND49, function () {
        client = mqtt.connect({
          port: ports.PORTAND49,
          host: 'localhost'
        })

        client.on('packetsend', function (packet) {
          if (packet.cmd === 'pubcomp') {
            client.end()
            server2.close()
            done()
          }
        })
      })
    })

    it('should not go overflow if the TCP frame contains a lot of PUBLISH packets', function (done) {
      var parser = mqttPacket.parser()
      var count = 0
      var max = 1000
      var duplex = new Duplex({
        read: function (n) {},
        write: function (chunk, enc, cb) {
          parser.parse(chunk)
          cb() // nothing to do
        }
      })
      client = new mqtt.MqttClient(function () {
        return duplex
      }, {})

      client.on('message', function (t, p, packet) {
        if (++count === max) {
          done()
        }
      })

      parser.on('packet', function (packet) {
        var packets = []

        if (packet.cmd === 'connect') {
          duplex.push(mqttPacket.generate({
            cmd: 'connack',
            sessionPresent: false,
            returnCode: 0
          }))

          for (var i = 0; i < max; i++) {
            packets.push(mqttPacket.generate({
              cmd: 'publish',
              topic: Buffer.from('hello'),
              payload: Buffer.from('world'),
              retain: false,
              dup: false,
              messageId: i + 1,
              qos: 1
            }))
          }

          duplex.push(Buffer.concat(packets))
        }
      })
    })
  })

  describe('flushing', function () {
    it('should attempt to complete pending unsub and send on ping timeout', function (done) {
      this.timeout(10000)
      var server3 = new MqttServer(function (client) {
        client.on('connect', function (packet) {
          client.connack({returnCode: 0})
        })
      }).listen(ports.PORTAND72)

      var pubCallbackCalled = false
      var unsubscribeCallbackCalled = false
      client = mqtt.connect({
        port: ports.PORTAND72,
        host: 'localhost',
        keepalive: 1,
        connectTimeout: 350,
        reconnectPeriod: 0
      })
      client.once('connect', () => {
        client.publish('fakeTopic', 'fakeMessage', {qos: 1}, (err, result) => {
          assert.exists(err)
          pubCallbackCalled = true
        })
        client.unsubscribe('fakeTopic', (err, result) => {
          assert.exists(err)
          unsubscribeCallbackCalled = true
        })
        setTimeout(() => {
          client.end(() => {
            assert.strictEqual(pubCallbackCalled && unsubscribeCallbackCalled, true, 'callbacks not invoked')
            server3.close()
            done()
          })
        }, 5000)
      })
    })
  })

  describe('reconnecting', function () {
    it('should attempt to reconnect once server is down', function (done) {
      this.timeout(30000)

      var innerServer = fork(path.join(__dirname, 'helpers', 'server_process.js'), { execArgv: ['--inspect'] })
      innerServer.on('close', (code) => {
        if (code) {
          done(util.format('child process closed with code %d', code))
        }
      })

      innerServer.on('exit', (code) => {
        if (code) {
          done(util.format('child process exited with code %d', code))
        }
      })

      client = mqtt.connect({ port: 3000, host: 'localhost', keepalive: 1 })
      client.once('connect', function () {
        innerServer.kill('SIGINT') // mocks server shutdown
        client.once('close', function () {
          assert.exists(client.reconnectTimer)
          client.end(true, done)
        })
      })
    })

    it('should reconnect to multiple host-ports-protocol combinations if servers is passed', function (done) {
      this.timeout(15000)
      var actualURL41 = 'wss://localhost:9917/'
      var actualURL42 = 'ws://localhost:9918/'
      var serverPort41 = serverBuilder(true).listen(ports.PORTAND41)
      var serverPort42 = serverBuilder(true).listen(ports.PORTAND42)

      serverPort42.on('listening', function () {
        client = mqtt.connect({
          protocol: 'wss',
          servers: [
            { port: ports.PORTAND41, host: 'localhost' },
            { port: ports.PORTAND42, host: 'localhost', protocol: 'ws' }
          ],
          keepalive: 50
        })
        serverPort41.once('client', function () {
          assert.equal(client.stream.socket.url, actualURL41, 'Protocol for second client should use the default protocol: wss, on port: port + 41.')
          client.end(true, done)
          serverPort41.close()
        })
        serverPort42.on('client', function (c) {
          assert.equal(client.stream.socket.url, actualURL42, 'Protocol for connection should use ws, on port: port + 42.')
          c.stream.destroy()
          serverPort42.close()
        })

        client.once('connect', function () {
          client.stream.destroy()
        })
      })
    })

    it('should reconnect if a connack is not received in an interval', function (done) {
      this.timeout(2000)

      var server2 = net.createServer().listen(ports.PORTAND43)

      server2.on('connection', function (c) {
        eos(c, function () {
          server2.close()
        })
      })

      server2.on('listening', function () {
        client = mqtt.connect({
          servers: [
            { port: ports.PORTAND43, host: 'localhost_fake' },
            { port: ports.PORT, host: 'localhost' }
          ],
          connectTimeout: 500
        })

        server.once('client', function () {
          client.end(true, done)
        })

        client.once('connect', function () {
          client.stream.destroy()
        })
      })
    })

    it('should not be cleared by the connack timer', function (done) {
      this.timeout(4000)

      var server2 = net.createServer().listen(ports.PORTAND44)

      server2.on('connection', function (c) {
        c.destroy()
      })

      server2.once('listening', function () {
        var reconnects = 0
        var connectTimeout = 1000
        var reconnectPeriod = 100
        var expectedReconnects = Math.floor(connectTimeout / reconnectPeriod)
        client = mqtt.connect({
          port: ports.PORTAND44,
          host: 'localhost',
          connectTimeout: connectTimeout,
          reconnectPeriod: reconnectPeriod
        })

        client.on('reconnect', function () {
          reconnects++
          if (reconnects >= expectedReconnects) {
            client.end(true, done)
          }
        })
      })
    })

    it('should not keep requeueing the first message when offline', function (done) {
      this.timeout(2500)

      var server2 = serverBuilder().listen(ports.PORTAND45)
      client = mqtt.connect({
        port: ports.PORTAND45,
        host: 'localhost',
        connectTimeout: 350,
        reconnectPeriod: 300
      })

      server2.on('client', function (c) {
        client.publish('hello', 'world', { qos: 1 }, function () {
          c.destroy()
          server2.close()
          client.publish('hello', 'world', { qos: 1 })
        })
      })

      setTimeout(function () {
        if (client.queue.length === 0) {
          client.end(true, done)
        } else {
          client.end(true)
        }
      }, 2000)
    })

    it('should not send the same subscribe multiple times on a flaky connection', function (done) {
      this.timeout(3500)

      var KILL_COUNT = 4
      var killedConnections = 0
      var subIds = {}
      client = mqtt.connect({
        port: ports.PORTAND46,
        host: 'localhost',
        connectTimeout: 350,
        reconnectPeriod: 300
      })

      var server2 = new MqttServer(function (client) {
        client.on('error', function () {})
        client.on('connect', function (packet) {
          if (packet.clientId === 'invalid') {
            client.connack({returnCode: 2})
          } else {
            client.connack({returnCode: 0})
          }
        })
      }).listen(ports.PORTAND46)

      server2.on('client', function (c) {
        client.subscribe('topic', function () {
          client.end(true, done)
          c.destroy()
          server2.close()
        })

        c.on('subscribe', function (packet) {
          if (killedConnections < KILL_COUNT) {
            // Kill the first few sub attempts to simulate a flaky connection
            killedConnections++
            c.destroy()
          } else {
            // Keep track of acks
            if (!subIds[packet.messageId]) {
              subIds[packet.messageId] = 0
            }
            subIds[packet.messageId]++
            if (subIds[packet.messageId] > 1) {
              done(new Error('Multiple duplicate acked subscriptions received for messageId ' + packet.messageId))
              client.end(true)
              c.destroy()
              server2.destroy()
            }

            c.suback({
              messageId: packet.messageId,
              granted: packet.subscriptions.map(function (e) {
                return e.qos
              })
            })
          }
        })
      })
    })

    it('should not fill the queue of subscribes if it cannot connect', function (done) {
      this.timeout(2500)

      var server2 = net.createServer(function (stream) {
        client = new Connection(stream)

        client.on('error', function (e) { /* do nothing */ })
        client.on('connect', function (packet) {
          client.connack({returnCode: 0})
          client.destroy()
        })
      })

      server2.listen(ports.PORTAND48, function () {
        client = mqtt.connect({
          port: ports.PORTAND48,
          host: 'localhost',
          connectTimeout: 350,
          reconnectPeriod: 300
        })

        client.subscribe('hello')

        setTimeout(function () {
          assert.equal(client.queue.length, 1)
          client.end(true, done)
        }, 1000)
      })
    })

    it('should not send the same publish multiple times on a flaky connection', function (done) {
      this.timeout(3500)

      var KILL_COUNT = 4
      var killedConnections = 0
      var pubIds = {}
      client = mqtt.connect({
        port: ports.PORTAND47,
        host: 'localhost',
        connectTimeout: 350,
        reconnectPeriod: 300
      })

      var server2 = net.createServer(function (stream) {
        client = new Connection(stream)
        client.on('error', function () {})
        client.on('connect', function (packet) {
          if (packet.clientId === 'invalid') {
            client.connack({returnCode: 2})
          } else {
            client.connack({returnCode: 0})
          }
        })

        this.emit('client', client)
      }).listen(ports.PORTAND47)

      server2.on('client', function (c) {
        client.publish('topic', 'data', { qos: 1 }, function () {
          client.end(true, done)
          c.destroy()
          server2.destroy()
        })

        c.on('publish', function onPublish (packet) {
          if (killedConnections < KILL_COUNT) {
            // Kill the first few pub attempts to simulate a flaky connection
            killedConnections++
            c.destroy()

            // to avoid receiving inflight messages
            c.removeListener('publish', onPublish)
          } else {
            // Keep track of acks
            if (!pubIds[packet.messageId]) {
              pubIds[packet.messageId] = 0
            }

            pubIds[packet.messageId]++

            if (pubIds[packet.messageId] > 1) {
              done(new Error('Multiple duplicate acked publishes received for messageId ' + packet.messageId))
              client.end(true)
              c.destroy()
              server2.destroy()
            }

            c.puback(packet)
          }
        })
      })
    })
  })

  it('check emit error on checkDisconnection w/o callback', function (done) {
    this.timeout(15000)

    var server118 = new MqttServer(function (client) {
      client.on('connect', function (packet) {
        client.connack({
          reasonCode: 0
        })
      })
      client.on('publish', function (packet) {
        setImmediate(function () {
          packet.reasonCode = 0
          client.puback(packet)
        })
      })
    }).listen(ports.PORTAND118)

    var opts = {
      host: 'localhost',
      port: ports.PORTAND118,
      protocolVersion: 5
    }
    client = mqtt.connect(opts)

    // wait for the client to receive an error...
    client.on('error', function (error) {
      assert.equal(error.message, 'client disconnecting')
      server118.close()
      done()
    })
    client.on('connect', function () {
      client.end(function () {
        client._checkDisconnecting()
      })
      server118.close()
    })
  })
})
