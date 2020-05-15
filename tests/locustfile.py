import random
from locust import HttpUser, task, between

class WebsiteUser(HttpUser):
    wait_time = between(5, 9)

    @task(2)
    def getnewaddress(self):
        self.client.get("/wallet/getnewaddress")

    @task(1)
    def index(self):
        self.client.get("/")