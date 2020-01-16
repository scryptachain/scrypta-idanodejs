var app = new Vue({
    el: '#app',
    data: {
        show: 'explorer',
        address: '',
        newaddress: {},
        status: {},
        block: {
            outputs: 0
        },
        height: 0,
        last: 0,
        written: '',
        received: '',
        axios: window.axios,
        showRaw: false
    },
    async mounted() {
        const app = this
        let response = await app.axios.get('/wallet/getinfo')
        app.status = response.data
        response = await app.axios.get('/block/last')
        app.block = response.data.data
        app.height = app.block.height
        app.written = app.block.data_written
        app.received = app.block.data_received
        app.last = app.height - 1
    },
    methods: {
        searchBlock(){
            const app = this
            app.showBlock(app.height)
        },
        async showBlock(last){
            const app = this
            response = await app.axios.get('/block/' + last)
            app.block = response.data.data
            app.height = app.block.height
            app.written = app.block.data_written
            app.received = app.block.data_received
            app.last = app.height - 1
        },
        async initAddress(){
            const app = this
            if(app.address !== ''){
                response = await app.axios.post('/init', { address: app.address })
                if(response.data.data.airdrop_tx !== false  && response.data.data.airdrop_tx !== null){
                    alert('Funds set correctly!')
                }else{
                    alert('This address received the faucet yet.')
                }
            }else{
                alert('Write an address first.')
            }
        },
        async createAddress(){
            const app = this
            response = await app.axios.get('/wallet/getnewaddress')
            app.newaddress = response.data
        },
        showExplorer(){
            const app = this
            app.show = 'explorer'
        },
        showTools(){
            const app = this
            app.show = 'tools'
        }
    }
})