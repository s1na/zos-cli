'use strict'
require('../setup')

import { Contracts, App } from 'zos-lib'

import push from '../../src/scripts/push'
import linkStdlib from '../../src/scripts/link'
import { bytecodeDigest } from '../../src/utils/contracts'
import ZosPackageFile from '../../src/models/files/ZosPackageFile'
import StatusComparator from '../../src/models/status/StatusComparator'

const ImplV1 = Contracts.getFromLocal('ImplV1')
const AnotherImplV1 = Contracts.getFromLocal('AnotherImplV1')

contract('StatusComparator', function([_, owner, anotherAddress]) {
  const network = 'test'
  const txParams = { from: owner }

  beforeEach('initializing network file and status checker', async function () {
    this.packageFile = new ZosPackageFile('test/mocks/packages/package-empty.zos.json')
    this.networkFile = this.packageFile.networkFile(network)
    this.checker = new StatusComparator(this.networkFile)
  })

  beforeEach('deploying an app', async function () {
    await push({ network, txParams, networkFile: this.networkFile })
    this.app = await App.fetch(this.networkFile.appAddress, txParams)
  })

  describe('version', function () {
    describe('when the network file shows a different version than the one set in the App contract', function () {
      const newVersion = '2.0.0'

      beforeEach(async function () {
        await this.app.newVersion(newVersion)
      })

      it('reports that diff', async function () {
        await this.checker.checkVersion()

        this.checker.reports.should.have.lengthOf(1)
        this.checker.reports[0].expected.should.be.equal('1.1.0')
        this.checker.reports[0].observed.should.be.equal('2.0.0')
        this.checker.reports[0].description.should.be.equal('App version does not match')
      })
    })

    describe('when the network file version matches with the one in the App contract', function () {
      it('does not report any diff', async function () {
        await this.checker.checkVersion()

        this.checker.reports.should.be.empty
      })
    })
  })

  describe('provider', function () {
    describe('when the network file shows a different provider address than the one set in the App contract', function () {
      beforeEach(async function () {
        await this.app.newVersion('2.0.0')
      })

      it('reports that diff', async function () {
        await this.checker.checkProvider()

        this.checker.reports.should.have.lengthOf(1)
        this.checker.reports[0].expected.should.be.equal(this.networkFile.providerAddress)
        this.checker.reports[0].observed.should.be.equal(this.app.currentDirectory().address)
        this.checker.reports[0].description.should.be.equal('Provider address does not match')
      })
    })

    describe('when the network file version matches with the one in the App contract', function () {
      it('does not report any diff', async function () {
        await this.checker.checkProvider()

        this.checker.reports.should.be.empty
      })
    })
  })

  describe('stdlib', function () {
    describe('when the network file does not specify any stdlib', function () {
      describe('when the App contract has a stdlib set', function () {
        beforeEach(async function () {
          await this.app.setStdlib(anotherAddress)
        })

        it('reports that diff', async function () {
          await this.checker.checkStdlib()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal(anotherAddress)
          this.checker.reports[0].description.should.be.equal('Stdlib address does not match')
        })
      })
      
      describe('when the App contract does not have a stdlib set', function () {
        it('does not report any diff', async function () {
          await this.checker.checkStdlib()

          this.checker.reports.should.be.empty
        })
      })
    })

    describe('when the network file has a stdlib', function () {
      const stdlibAddress = '0x0000000000000000000000000000000000000010'

      beforeEach('set stdlib in network file', async function () {
        await linkStdlib({stdlibNameVersion: 'mock-stdlib@1.1.0', packageFile: this.packageFile})
        await push({ network, txParams, networkFile: this.networkFile })
      })

      describe('when the App contract has the same stdlib set', function () {
        beforeEach('set stdlib in App contract', async function () {
          await this.app.setStdlib(stdlibAddress)
        })

        it('does not report any diff', async function () {
          await this.checker.checkStdlib()

          this.checker.reports.should.be.empty
        })
      })

      describe('when the App contract has another stdlib set', function () {
        beforeEach('set stdlib in App contract', async function () {
          await this.app.setStdlib(anotherAddress)
        })

        it('reports that diff', async function () {
          await this.checker.checkStdlib()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal(stdlibAddress)
          this.checker.reports[0].observed.should.be.equal(anotherAddress)
          this.checker.reports[0].description.should.be.equal('Stdlib address does not match')
        })
      })

      describe('when the App contract has no stdlib set', function () {
        beforeEach('unset App stdlib', async function () {
          await this.app.setStdlib(0x0)
        })

        it('reports that diff', async function () {
          await this.checker.checkStdlib()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal(stdlibAddress)
          this.checker.reports[0].observed.should.be.equal('none')
          this.checker.reports[0].description.should.be.equal('Stdlib address does not match')
        })
      })
    })
  })

  describe('implementations', function () {
    describe('when the network file does not have any contract', function () {
      describe('when the directory of the current version does not have any contract', function () {
        it('does not report any diff', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.be.empty
        })
      })

      describe('when the directory of the current version has one contract', function () {
        beforeEach('registering new implementation in AppDirectory', async function () {
          await this.app.setImplementation(ImplV1, 'Impl')
        })

        it('reports that diff', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal('Impl')
          this.checker.reports[0].description.should.be.equal('Contract does not match')
        })
      })

      describe('when the directory of the current version has many contracts', function () {
        beforeEach('registering two new implementations in AppDirectory', async function () {
          await this.app.setImplementation(ImplV1, 'Impl')
          await this.app.setImplementation(AnotherImplV1, 'AnotherImpl')
        })

        it('reports one diff per contract', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.have.lengthOf(2)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal('Impl')
          this.checker.reports[0].description.should.be.equal('Contract does not match')
          this.checker.reports[1].expected.should.be.equal('none')
          this.checker.reports[1].observed.should.be.equal('AnotherImpl')
          this.checker.reports[1].description.should.be.equal('Contract does not match')
        })
      })

      describe('when the directory of the current version has many contracts and some of them where unregistered', function () {
        beforeEach('registering two new implementations in AppDirectory', async function () {
          await this.app.setImplementation(ImplV1, 'Impl')
          // TODO: provide unset impl method from lib
          await this.app.currentDirectory().unsetImplementation('Impl', txParams)
          await this.app.setImplementation(AnotherImplV1, 'AnotherImpl')
        })

        it('reports one diff per contract', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal('AnotherImpl')
          this.checker.reports[0].description.should.be.equal('Contract does not match')
        })
      })
    })

    describe('when the network file has some contracts', function () {
      beforeEach('adding some contracts', async function () {
        this.impl = await ImplV1.new()
        this.anotherImpl = await AnotherImplV1.new()

        this.networkFile.setContract('Impl', this.impl)
        this.networkFile.setContract('AnotherImpl', this.anotherImpl)
      })

      describe('when the directory of the current version does not have any contract', function () {
        it('reports that diff', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.have.lengthOf(2)
          this.checker.reports[0].expected.should.be.equal('Impl')
          this.checker.reports[0].observed.should.be.equal('none')
          this.checker.reports[0].description.should.be.equal('Contract does not match')
          this.checker.reports[1].expected.should.be.equal('AnotherImpl')
          this.checker.reports[1].observed.should.be.equal('none')
          this.checker.reports[1].description.should.be.equal('Contract does not match')
        })
      })

      describe('when the directory of the current version has one of those contract', function () {
        describe('when the directory has the same address and same bytecode for that contract', function () {
          beforeEach('registering new implementation in AppDirectory', async function () {
            await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
          })

          it('reports only the missing contract', async function () {
            await this.checker.checkImplementations()

            this.checker.reports.should.have.lengthOf(1)
            this.checker.reports[0].expected.should.be.equal('AnotherImpl')
            this.checker.reports[0].observed.should.be.equal('none')
            this.checker.reports[0].description.should.be.equal('Contract does not match')
          })
        })

        describe('when the directory has another address for that contract', function () {
          beforeEach('registering new implementation in AppDirectory', async function () {
            await this.app.currentDirectory().setImplementation('Impl', this.anotherImpl.address, txParams)
          })

          it('reports both diffs', async function () {
            await this.checker.checkImplementations()

            this.checker.reports.should.have.lengthOf(2)
            this.checker.reports[0].expected.should.be.equal(this.impl.address)
            this.checker.reports[0].observed.should.be.equal(this.anotherImpl.address)
            this.checker.reports[0].description.should.be.equal('Address for contract Impl does not match')
            this.checker.reports[1].expected.should.be.equal('AnotherImpl')
            this.checker.reports[1].observed.should.be.equal('none')
            this.checker.reports[1].description.should.be.equal('Contract does not match')
          })
        })

        describe('when the bytecode for that contract is different', function () {
          beforeEach('registering new implementation in AppDirectory', async function () {
            const contracts = this.networkFile.contracts
            contracts.Impl.bytecodeHash = '0x0'
            this.networkFile.contracts = contracts
            await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
          })

          it('reports both diffs', async function () {
            await this.checker.checkImplementations()

            this.checker.reports.should.have.lengthOf(2)
            this.checker.reports[0].expected.should.be.equal('0x0')
            this.checker.reports[0].observed.should.be.equal(bytecodeDigest(ImplV1.bytecode))
            this.checker.reports[0].description.should.be.equal(`Bytecode at ${this.impl.address} for contract Impl does not match`)
            this.checker.reports[1].expected.should.be.equal('AnotherImpl')
            this.checker.reports[1].observed.should.be.equal('none')
            this.checker.reports[1].description.should.be.equal('Contract does not match')
          })
        })
      })

      describe('when the directory of the current version has both contracts', function () {
        beforeEach('registering new implementation in AppDirectory', async function () {
          await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
          await this.app.currentDirectory().setImplementation('AnotherImpl', this.anotherImpl.address, txParams)
        })

        it('does not report any diff ', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.be.empty
        })
      })

      describe('when the directory of the current version has many contracts and some of them where unregistered', function () {
        beforeEach('registering two new implementations in AppDirectory', async function () {
          await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
          // TODO: provide unset impl method from lib
          await this.app.currentDirectory().unsetImplementation('Impl', txParams)
          await this.app.currentDirectory().setImplementation('AnotherImpl', this.anotherImpl.address, txParams)
        })

        it('reports one diff per contract', async function () {
          await this.checker.checkImplementations()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal('Impl')
          this.checker.reports[0].observed.should.be.equal('none')
          this.checker.reports[0].description.should.be.equal('Contract does not match')
        })
      })
    })
  })

  describe('proxies', function () {
    beforeEach('adding some contracts', async function () {
      this.impl = await ImplV1.new()
      this.anotherImpl = await AnotherImplV1.new()

      this.networkFile.setContract('Impl', this.impl)
      this.networkFile.setContract('AnotherImpl', this.anotherImpl)

      await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
      await this.app.currentDirectory().unsetImplementation('Impl', txParams)
      await this.app.currentDirectory().setImplementation('AnotherImpl', this.anotherImpl.address, txParams)
      await this.app.currentDirectory().setImplementation('Impl', this.impl.address, txParams)
    })

    describe('when the network file does not have any proxies', function () {
      describe('when the app does not have any proxy registered', function () {
        it('does not report any diff', async function () {
          await this.checker.checkProxies()

          this.checker.reports.should.be.empty
        })
      })

      describe('when the app has one proxy registered', function () {
        beforeEach('registering new implementation in AppDirectory', async function () {
          await this.app.createProxy(ImplV1, 'Impl', 'initialize', [42])
        })

        it('reports that diff', async function () {
          await this.checker.checkProxies()

          this.checker.reports.should.have.lengthOf(1)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal('Impl')
          this.checker.reports[0].description.should.be.equal('Proxy does not match')
        })
      })

      describe('when the app has many proxies registered', function () {
        beforeEach('registering new implementation in AppDirectory', async function () {
          await this.app.createProxy(ImplV1, 'Impl', 'initialize', [42])
          await this.app.createProxy(AnotherImplV1, 'AnotherImpl', 'initialize', [1])
        })

        it('reports that diff', async function () {
          await this.checker.checkProxies()

          this.checker.reports.should.have.lengthOf(2)
          this.checker.reports[0].expected.should.be.equal('none')
          this.checker.reports[0].observed.should.be.equal('Impl')
          this.checker.reports[0].description.should.be.equal('Proxy does not match')
          this.checker.reports[1].expected.should.be.equal('none')
          this.checker.reports[1].observed.should.be.equal('AnotherImpl')
          this.checker.reports[1].description.should.be.equal('Proxy does not match')
        })
      })
    })

    describe('when the network file has two proxies', function () {
      beforeEach('adding a proxy', async function () {
        this.networkFile.setProxy('Impl', [
          { implementation: this.impl.address, address: '0x1', version: '1.0' },
          { implementation: this.impl.address, address: '0x2', version: '1.0' }
        ])
      })

      describe('when the app does not have any proxy registered', function () {
        it('reports those diffs', async function () {
          await this.checker.checkProxies()

          this.checker.reports.should.be.have.lengthOf(2)
          this.checker.reports[0].expected.should.be.equal(1)
          this.checker.reports[0].observed.should.be.equal(0)
          this.checker.reports[0].description.should.be.equal(`Proxy of Impl at 0x1 pointing to ${this.impl.address} does not match`)
          this.checker.reports[1].expected.should.be.equal(1)
          this.checker.reports[1].observed.should.be.equal(0)
          this.checker.reports[1].description.should.be.equal(`Proxy of Impl at 0x2 pointing to ${this.impl.address} does not match`)
        })
      })

      describe('when the app has one proxy registered', function () {
        describe('when it matches one proxy address', function () {
          beforeEach('creating a proxy', async function () {
            this.proxy = await this.app.createProxy(ImplV1, 'Impl', 'initialize', [42])
            this.networkFile.setProxy('Impl', [
              { implementation: this.impl.address, address: '0x1', version: '1.0' },
              { implementation: this.impl.address, address: this.proxy.address, version: '1.0' },
            ])
          })

          it('reports that diff', async function () {
            await this.checker.checkProxies()

            this.checker.reports.should.have.lengthOf(1)
            this.checker.reports[0].expected.should.be.equal('0x1')
            this.checker.reports[0].observed.should.be.equal(this.proxy.address)
            this.checker.reports[0].description.should.be.equal(`Proxy of Impl at 0x1 pointing to ${this.impl.address} does not match`)
          })
        })

        describe('when it does not match any proxy address', function () {
          beforeEach('creating a proxy', async function () {
            this.proxy = await this.app.createProxy(ImplV1, 'Impl', 'initialize', [42])
          })

          it('reports those diffs', async function () {
            await this.checker.checkProxies()

            this.checker.reports.should.have.lengthOf(2)
            this.checker.reports[0].expected.should.be.equal('0x1')
            this.checker.reports[0].observed.should.be.equal(this.proxy.address)
            this.checker.reports[0].description.should.be.equal(`Proxy of Impl at 0x1 pointing to ${this.impl.address} does not match`)
            this.checker.reports[1].expected.should.be.equal('0x2')
            this.checker.reports[1].observed.should.be.equal(this.proxy.address)
            this.checker.reports[1].description.should.be.equal(`Proxy of Impl at 0x2 pointing to ${this.impl.address} does not match`)
          })
        })
      })
    })
  })
})
