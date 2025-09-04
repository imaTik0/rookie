import { ConfigService } from "./service/ConfigService.ts";
import { Hono } from "hono";

export class App {
    private honoServer: Hono;
    
    constructor(
        private configService: ConfigService,
    ) {
        this.honoServer = new Hono()
    }

    init() {
        
    }
}