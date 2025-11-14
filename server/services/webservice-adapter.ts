
import { Request, Response } from 'express';
import { webServiceController } from './webservice-controller';

/**
 * WebService Adapter - Converts HTTP requests to webservice method calls
 */
export class WebServiceAdapter {
  
  static async handleGetServerInfo(req: Request, res: Response) {
    const result = await webServiceController.getServerInfo();
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGetDashboardStats(req: Request, res: Response) {
    const result = await webServiceController.getDashboardStats();
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGetAllBotInstances(req: Request, res: Response) {
    const result = await webServiceController.getAllBotInstances();
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGetBotInstance(req: Request, res: Response) {
    const { id } = req.params;
    const result = await webServiceController.getBotInstance(id);
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(404).json({ message: result.error });
    }
  }

  static async handleStartBot(req: Request, res: Response) {
    const { id } = req.params;
    const result = await webServiceController.startBot(id);
    
    if (result.success) {
      return res.json({ message: result.message });
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleStopBot(req: Request, res: Response) {
    const { id } = req.params;
    const result = await webServiceController.stopBot(id);
    
    if (result.success) {
      return res.json({ message: result.message });
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleRestartBot(req: Request, res: Response) {
    const { id } = req.params;
    const result = await webServiceController.restartBot(id);
    
    if (result.success) {
      return res.json({ message: result.message });
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGeneratePairingCode(req: Request, res: Response) {
    const phoneNumber = req.query.number as string;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone number is required' 
      });
    }

    const result = await webServiceController.generatePairingCode(phoneNumber);
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ 
        success: false, 
        error: result.error 
      });
    }
  }

  static async handleGetGuestSession(req: Request, res: Response) {
    const { phoneNumber } = req.params;
    const result = await webServiceController.getGuestSession(phoneNumber);
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleValidateCredentials(req: Request, res: Response) {
    const { sessionData, phoneNumber } = req.body;
    let credentials;

    try {
      if (sessionData) {
        let base64Data = sessionData.trim();
        if (base64Data.startsWith('TREKKER~')) {
          base64Data = base64Data.substring(8);
        }
        credentials = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf-8'));
      } else if (req.file) {
        credentials = JSON.parse((req.file as any).buffer.toString());
      } else {
        return res.status(400).json({
          message: 'Please provide credentials either as file upload or Base64 session data'
        });
      }
    } catch (error) {
      return res.status(400).json({
        message: '❌ Invalid credentials format'
      });
    }

    const result = await webServiceController.validateCredentials(credentials, phoneNumber);
    
    if (result.success) {
      return res.json({
        valid: result.valid,
        message: result.message,
        phoneNumber: result.phoneNumber,
        isUnique: result.isUnique
      });
    } else {
      return res.status(400).json({
        valid: result.valid,
        message: result.message,
        isDuplicate: result.isDuplicate
      });
    }
  }

  static async handleCheckRegistration(req: Request, res: Response) {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    const result = await webServiceController.checkRegistration(phoneNumber);
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleRegisterBot(req: Request, res: Response) {
    const { botName, phoneNumber, sessionId, features, selectedServer } = req.body;
    
    if (!botName || !phoneNumber || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Bot name, phone number, and session ID are required'
      });
    }

    const result = await webServiceController.registerBot({
      botName,
      phoneNumber,
      sessionId,
      features: features || {},
      selectedServer
    });
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json({ 
        success: false, 
        message: result.error 
      });
    }
  }

  static async handleGetOfferStatus(req: Request, res: Response) {
    const result = await webServiceController.getOfferStatus();
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGetAvailableServers(req: Request, res: Response) {
    const result = await webServiceController.getAvailableServers();
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }

  static async handleGetActivities(req: Request, res: Response) {
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await webServiceController.getActivities(limit);
    
    if (result.success) {
      return res.json(result.data);
    } else {
      return res.status(500).json({ message: result.error });
    }
  }
}
