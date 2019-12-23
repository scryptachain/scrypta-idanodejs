var app = new Vue({
    el: '#app',
    data: {
        status: {},
        block: {
            outputs: 0
        },
        height: 0,
        last: 0,
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
        app.last = app.height - 1
    },
    methods: {
        async showBlock(last){
            const app = this
            response = await app.axios.get('/block/' + last)
            app.block = response.data.data
            app.height = app.block.height
            app.last = app.height - 1
        }
    }
})