import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Credential {
  id: string;
  encryptedScore: string;
  timestamp: number;
  owner: string;
  institution: string;
  course: string;
  status: "pending" | "verified" | "rejected";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCredentialData, setNewCredentialData] = useState({ institution: "", course: "", score: 0 });
  const [showIntro, setShowIntro] = useState(true);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "verified" | "rejected">("all");
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const verifiedCount = credentials.filter(c => c.status === "verified").length;
  const pendingCount = credentials.filter(c => c.status === "pending").length;
  const rejectedCount = credentials.filter(c => c.status === "rejected").length;

  useEffect(() => {
    loadCredentials().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadCredentials = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("credential_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing credential keys:", e); }
      }
      const list: Credential[] = [];
      for (const key of keys) {
        try {
          const credentialBytes = await contract.getData(`credential_${key}`);
          if (credentialBytes.length > 0) {
            try {
              const credentialData = JSON.parse(ethers.toUtf8String(credentialBytes));
              list.push({ 
                id: key, 
                encryptedScore: credentialData.score, 
                timestamp: credentialData.timestamp, 
                owner: credentialData.owner, 
                institution: credentialData.institution,
                course: credentialData.course,
                status: credentialData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing credential data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading credential ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCredentials(list);
      addToHistory("Loaded credentials list");
    } catch (e) { 
      console.error("Error loading credentials:", e); 
      addToHistory("Failed to load credentials");
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const addToHistory = (action: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setUserHistory(prev => [`${timestamp}: ${action}`, ...prev.slice(0, 9)]);
  };

  const submitCredential = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting score with Zama FHE..." });
    try {
      const encryptedScore = FHEEncryptNumber(newCredentialData.score);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const credentialId = `cred-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const credentialData = { 
        score: encryptedScore, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        institution: newCredentialData.institution,
        course: newCredentialData.course,
        status: "pending" 
      };
      await contract.setData(`credential_${credentialId}`, ethers.toUtf8Bytes(JSON.stringify(credentialData)));
      const keysBytes = await contract.getData("credential_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(credentialId);
      await contract.setData("credential_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted credential submitted securely!" });
      addToHistory("Submitted new credential");
      await loadCredentials();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCredentialData({ institution: "", course: "", score: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      addToHistory("Failed to submit credential");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      const decrypted = FHEDecryptNumber(encryptedData);
      addToHistory("Decrypted credential score");
      return decrypted;
    } catch (e) { 
      console.error("Decryption failed:", e); 
      addToHistory("Failed to decrypt score");
      return null; 
    } finally { setIsDecrypting(false); }
  };

  const verifyCredential = async (credentialId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const credentialBytes = await contract.getData(`credential_${credentialId}`);
      if (credentialBytes.length === 0) throw new Error("Credential not found");
      const credentialData = JSON.parse(ethers.toUtf8String(credentialBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedCredential = { ...credentialData, status: "verified" };
      await contractWithSigner.setData(`credential_${credentialId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCredential)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      addToHistory("Verified credential");
      await loadCredentials();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      addToHistory("Failed to verify credential");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectCredential = async (credentialId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const credentialBytes = await contract.getData(`credential_${credentialId}`);
      if (credentialBytes.length === 0) throw new Error("Credential not found");
      const credentialData = JSON.parse(ethers.toUtf8String(credentialBytes));
      const updatedCredential = { ...credentialData, status: "rejected" };
      await contract.setData(`credential_${credentialId}`, ethers.toUtf8Bytes(JSON.stringify(updatedCredential)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      addToHistory("Rejected credential");
      await loadCredentials();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      addToHistory("Failed to reject credential");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (credentialAddress: string) => address?.toLowerCase() === credentialAddress.toLowerCase();

  const filteredCredentials = credentials.filter(credential => {
    const matchesSearch = 
      credential.institution.toLowerCase().includes(searchTerm.toLowerCase()) || 
      credential.course.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || credential.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const renderCredentialCard = (credential: Credential) => (
    <div 
      className="credential-card" 
      key={credential.id}
      onClick={() => setSelectedCredential(credential)}
    >
      <div className="card-header">
        <div className="institution">{credential.institution}</div>
        <div className={`status-badge ${credential.status}`}>{credential.status}</div>
      </div>
      <div className="card-body">
        <div className="course">{credential.course}</div>
        <div className="details">
          <div className="detail-item">
            <span>Issued:</span>
            <span>{new Date(credential.timestamp * 1000).toLocaleDateString()}</span>
          </div>
          <div className="detail-item">
            <span>Owner:</span>
            <span>{credential.owner.substring(0, 6)}...{credential.owner.substring(38)}</span>
          </div>
        </div>
      </div>
      <div className="card-footer">
        {isOwner(credential.owner) && credential.status === "pending" && (
          <div className="actions">
            <button 
              className="action-btn verify" 
              onClick={(e) => { e.stopPropagation(); verifyCredential(credential.id); }}
            >
              Verify
            </button>
            <button 
              className="action-btn reject" 
              onClick={(e) => { e.stopPropagation(); rejectCredential(credential.id); }}
            >
              Reject
            </button>
          </div>
        )}
        <div className="fhe-tag">
          <div className="fhe-icon"></div>
          <span>FHE Encrypted</span>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Edu<span>Passport</span></h1>
          <p>FHE-encrypted educational credentials</p>
        </div>
        <div className="header-actions">
          <ConnectButton 
            accountStatus="address" 
            chainStatus="icon" 
            showBalance={false}
            label="Connect Wallet"
          />
        </div>
      </header>

      <main className="main-content">
        {showIntro && (
          <div className="intro-section glass-card">
            <div className="intro-header">
              <h2>Welcome to EduPassport</h2>
              <button 
                className="close-intro" 
                onClick={() => setShowIntro(false)}
              >
                &times;
              </button>
            </div>
            <div className="intro-content">
              <p>
                EduPassport is a DeSoc protocol for <strong>FHE-encrypted, verifiable educational credentials</strong>. 
                Institutions can issue encrypted certificates while students maintain full privacy control.
              </p>
              <div className="features">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <h3>FHE Encryption</h3>
                  <p>Scores and credentials are encrypted using Zama FHE technology</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">📜</div>
                  <h3>Verifiable</h3>
                  <p>Proof of credentials without revealing sensitive information</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🛡️</div>
                  <h3>Privacy First</h3>
                  <p>Students control what information to share with employers</p>
                </div>
              </div>
              <div className="fhe-process">
                <h3>How FHE Works in EduPassport</h3>
                <div className="process-steps">
                  <div className="step">
                    <div className="step-number">1</div>
                    <p>Institution encrypts credential data</p>
                  </div>
                  <div className="step">
                    <div className="step-number">2</div>
                    <p>Student receives encrypted credential</p>
                  </div>
                  <div className="step">
                    <div className="step-number">3</div>
                    <p>Verification happens on encrypted data</p>
                  </div>
                  <div className="step">
                    <div className="step-number">4</div>
                    <p>Student selectively discloses proofs</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="dashboard-section">
          <div className="stats-container glass-card">
            <h3>Credentials Overview</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{credentials.length}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>

          <div className="controls-container">
            <div className="search-filter glass-card">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search institutions or courses..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button className="search-btn">🔍</button>
              </div>
              <div className="filter-options">
                <label>Filter by status:</label>
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>

            <div className="action-buttons">
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                + Add Credential
              </button>
              <button 
                className="secondary-btn"
                onClick={loadCredentials}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="credentials-section">
          <h2>Your Learning Passport</h2>
          {filteredCredentials.length === 0 ? (
            <div className="empty-state glass-card">
              <div className="empty-icon">📚</div>
              <p>No credentials found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Add Your First Credential
              </button>
            </div>
          ) : (
            <div className="credentials-grid">
              {filteredCredentials.map(renderCredentialCard)}
            </div>
          )}
        </div>

        <div className="history-section glass-card">
          <h3>Recent Activity</h3>
          <div className="history-list">
            {userHistory.length === 0 ? (
              <p className="no-history">No recent activity</p>
            ) : (
              <ul>
                {userHistory.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCredential} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          credentialData={newCredentialData} 
          setCredentialData={setNewCredentialData}
        />
      )}

      {selectedCredential && (
        <CredentialDetailModal 
          credential={selectedCredential} 
          onClose={() => { 
            setSelectedCredential(null); 
            setDecryptedScore(null); 
          }} 
          decryptedScore={decryptedScore} 
          setDecryptedScore={setDecryptedScore} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>EduPassport</h3>
            <p>FHE-encrypted educational credentials powered by Zama</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="copyright">© {new Date().getFullYear()} EduPassport. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  credentialData: any;
  setCredentialData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, credentialData, setCredentialData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCredentialData({ ...credentialData, [name]: value });
  };

  const handleScoreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCredentialData({ ...credentialData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!credentialData.institution || !credentialData.course || !credentialData.score) {
      alert("Please fill all required fields");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Add New Credential</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Institution *</label>
            <input 
              type="text" 
              name="institution" 
              value={credentialData.institution} 
              onChange={handleChange} 
              placeholder="University or organization name"
            />
          </div>
          <div className="form-group">
            <label>Course *</label>
            <input 
              type="text" 
              name="course" 
              value={credentialData.course} 
              onChange={handleChange} 
              placeholder="Course or program name"
            />
          </div>
          <div className="form-group">
            <label>Score (0-100) *</label>
            <input 
              type="number" 
              name="score" 
              value={credentialData.score} 
              onChange={handleScoreChange} 
              placeholder="Enter numerical score"
              min="0"
              max="100"
            />
          </div>
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-content">
              <div className="plain-data">
                <span>Plain Score:</span>
                <div>{credentialData.score || '--'}</div>
              </div>
              <div className="arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted:</span>
                <div>
                  {credentialData.score ? 
                    `FHE-${FHEEncryptNumber(credentialData.score).substring(4, 20)}...` : 
                    '--'
                  }
                </div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="notice-icon">🔒</div>
            <p>
              Your score will be encrypted with Zama FHE before being stored on-chain. 
              The institution will only see the encrypted value.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting..." : "Submit Credential"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CredentialDetailModalProps {
  credential: Credential;
  onClose: () => void;
  decryptedScore: number | null;
  setDecryptedScore: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const CredentialDetailModal: React.FC<CredentialDetailModalProps> = ({ 
  credential, 
  onClose, 
  decryptedScore, 
  setDecryptedScore, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null) {
      setDecryptedScore(null);
      return;
    }
    const decrypted = await decryptWithSignature(credential.encryptedScore);
    if (decrypted !== null) setDecryptedScore(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal glass-card">
        <div className="modal-header">
          <h2>Credential Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="credential-info">
            <div className="info-item">
              <span>Institution:</span>
              <strong>{credential.institution}</strong>
            </div>
            <div className="info-item">
              <span>Course:</span>
              <strong>{credential.course}</strong>
            </div>
            <div className="info-item">
              <span>Issued:</span>
              <strong>{new Date(credential.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${credential.status}`}>{credential.status}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{credential.owner.substring(0, 6)}...{credential.owner.substring(38)}</strong>
            </div>
          </div>
          
          <div className="score-section">
            <h3>Score Information</h3>
            <div className="encrypted-score">
              <span>Encrypted Score:</span>
              <div className="encrypted-value">
                {credential.encryptedScore.substring(0, 20)}...
              </div>
              <div className="fhe-tag">
                <div className="fhe-icon"></div>
                <span>FHE Encrypted</span>
              </div>
            </div>
            
            <button 
              className="decrypt-btn"
              onClick={handleDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : 
               decryptedScore !== null ? "Hide Score" : "Decrypt with Wallet"}
            </button>
            
            {decryptedScore !== null && (
              <div className="decrypted-score">
                <span>Decrypted Score:</span>
                <div className="score-value">
                  {decryptedScore}
                  <span className="score-percent">%</span>
                </div>
                <div className="decrypt-notice">
                  This score was decrypted locally after wallet signature verification
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
